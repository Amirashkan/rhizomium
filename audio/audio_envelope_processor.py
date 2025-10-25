# -*- coding: utf-8 -*-
from __future__ import annotations
import time
import threading
from dataclasses import dataclass

@dataclass
class FollowerParams:
    attack_ms: float = 50.0     # 0–200
    release_ms: float = 200.0   # 0–500
    threshold: float = 0.1      # 0–1

@dataclass
class ADSRParams:
    attack_ms: float = 120.0    # 0–2000
    decay_ms: float = 180.0     # 0–2000
    sustain: float = 0.7        # 0–1
    release_ms: float = 600.0   # 0–3000

@dataclass
class OutputShaping:
    curve: str = "exp"   # "linear" | "exp" | "sigmoid"
    normalize: bool = True
    norm_decay: float = 0.999  # leaky peak decay

class AudioEnvelopeProcessor:
    """
    Global Hybrid Envelope:
    audio_rms -> follower (AR) -> gate(threshold) -> ADSR -> shaped 0..1
    Thread-safe get_value().
    """
    def __init__(self,
                 follower: FollowerParams = FollowerParams(),
                 adsr: ADSRParams = ADSRParams(),
                 shaping: OutputShaping = OutputShaping(),
                 sample_rate: float = 48000.0):
        self.f = follower
        self.a = adsr
        self.s = shaping
        self.fs = sample_rate

        # follower state
        self._fol_val = 0.0

        # adsr state machine
        self._env = 0.0
        self._phase = "idle"  # idle, attack, decay, sustain, release

        # norm
        self._peak = 1e-6

        # threading
        self._lock = threading.Lock()
        self._last_ts = time.perf_counter()

    def reset(self):
        with self._lock:
            self._fol_val = 0.0
            self._env = 0.0
            self._phase = "idle"
            self._peak = 1e-6
            self._last_ts = time.perf_counter()

    def _sec(self, ms: float) -> float:
        return max(ms, 0.0) / 1000.0

    def _follower_step(self, x: float, dt: float) -> float:
        # AR one-pole smoothing on RMS
        atk_tc = self._sec(self.f.attack_ms)
        rel_tc = self._sec(self.f.release_ms)
        atk_coeff = 0.0 if atk_tc == 0 else pow(0.01, dt / atk_tc)
        rel_coeff = 0.0 if rel_tc == 0 else pow(0.01, dt / rel_tc)

        if x > self._fol_val:
            y = (1 - atk_coeff) * x + atk_coeff * self._fol_val
        else:
            y = (1 - rel_coeff) * x + rel_coeff * self._fol_val
        self._fol_val = y
        return y

    def _adsr_step(self, gate: bool, dt: float) -> float:
        a = self.a
        if gate:
            if self._phase in ("idle", "release"):
                self._phase = "attack"
        else:
            if self._phase != "idle":
                self._phase = "release"

        if self._phase == "attack":
            a_sec = self._sec(a.attack_ms)
            if a_sec <= 0:
                self._env = 1.0
                self._phase = "decay"
            else:
                self._env += dt / a_sec
                if self._env >= 1.0:
                    self._env = 1.0
                    self._phase = "decay"

        elif self._phase == "decay":
            d_sec = self._sec(a.decay_ms)
            target = max(min(a.sustain, 1.0), 0.0)
            if d_sec <= 0:
                self._env = target
                self._phase = "sustain"
            else:
                # exponential-ish decay
                self._env += (target - self._env) * min(dt / d_sec, 1.0)
                if abs(self._env - target) < 1e-4:
                    self._env = target
                    self._phase = "sustain"

        elif self._phase == "sustain":
            # hold current value until gate off
            pass

        elif self._phase == "release":
            r_sec = self._sec(a.release_ms)
            if r_sec <= 0:
                self._env = 0.0
                self._phase = "idle"
            else:
                self._env += (0.0 - self._env) * min(dt / r_sec, 1.0)
                if self._env <= 1e-4:
                    self._env = 0.0
                    self._phase = "idle"

        return self._env

    def _shape(self, v: float) -> float:
        v = max(0.0, min(1.0, v))
        if self.s.curve == "linear":
            return v
        elif self.s.curve == "sigmoid":
            # smoothstep-like
            return v * v * (3 - 2 * v)
        else:  # "exp"
            return v ** 0.5

    def _maybe_normalize(self, x: float) -> float:
        if not self.s.normalize:
            return max(0.0, min(1.0, x))
        # leaky peak tracker
        self._peak = max(x, self._peak * self.s.norm_decay)
        if self._peak < 1e-6:
            return 0.0
        return max(0.0, min(1.0, x / self._peak))

    def process_block_rms(self, block_rms: float):
        """
        Call this from audio callback with block RMS (0..~1).
        """
        now = time.perf_counter()
        dt = now - self._last_ts
        self._last_ts = now

        # follower
        fol = self._follower_step(block_rms, dt)

        # gate via threshold
        gate = fol > self.f.threshold

        # ADSR
        env = self._adsr_step(gate, dt)

        # combine follower energy with ADSR shape (hybrid)
        raw = env * fol

        # normalize + shape
        val = self._maybe_normalize(raw)
        val = self._shape(val)

        with self._lock:
            self._value = val

    def get_value(self) -> float:
        with self._lock:
            return getattr(self, "_value", 0.0)
