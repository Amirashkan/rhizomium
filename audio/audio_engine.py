# -*- coding: utf-8 -*-
from __future__ import annotations
import numpy as np
import sounddevice as sd
import threading
from audio.audio_envelope_processor import AudioEnvelopeProcessor, FollowerParams, ADSRParams, OutputShaping

class AudioEngine:
    """
    PortAudio/WASAPI input → block RMS → AudioEnvelopeProcessor (GLOBAL)
    mode: "mic" | "loopback"
    """
    def __init__(self,
                 mode: str = "mic",
                 samplerate: int | None = None,
                 channels: int = 2,
                 device_name_hint: str | None = None,
                 follower: FollowerParams = FollowerParams(),
                 adsr: ADSRParams = ADSRParams(),
                 shaping: OutputShaping = OutputShaping(curve="exp", normalize=True)):
        assert mode in ("mic", "loopback")
        self.mode = mode
        self.channels = channels
        self.stream = None
        self._lock = threading.Lock()

        # pick device
        self.device = self._pick_device(mode, device_name_hint)
        self.samplerate = samplerate or int(sd.query_devices(self.device, "input")["default_samplerate"])

        # global processor
        self.processor = AudioEnvelopeProcessor(follower, adsr, shaping, sample_rate=self.samplerate)

    def _pick_device(self, mode: str, hint: str | None):
        # Strategy:
        # - If hint provided, try to match (case-insensitive) in device name
        # - Otherwise:
        #   * loopback: prefer devices containing "(loopback)" on Windows WASAPI
        #   * mic: default input device
        devices = sd.query_devices()
        candidates = []
        for i, d in enumerate(devices):
            if d["max_input_channels"] <= 0:
                continue
            name = d["name"].lower()
            if hint and hint.lower() in name:
                return i
            if mode == "loopback" and "(loopback)" in name:
                candidates.append(i)

        if mode == "loopback" and candidates:
            return candidates[0]

        # fallback to default input
        return sd.default.device[0]  # input device index

    def start(self, blocksize: int = 1024, latency: str = "low"):
        def _callback(indata, frames, time_, status):
            if status:
                # optionally: log status
                pass
            # indata: shape (frames, channels), float32
            # block RMS across all channels
            x = indata.astype(np.float32, copy=False)
            if x.ndim == 2:
                # stereo RMS → mono energy
                rms = np.sqrt(np.mean(x**2, axis=0)).mean()
            else:
                rms = float(np.sqrt(np.mean(x**2)))

            # clamp
            rms = float(max(0.0, min(1.5, rms)))  # allow >1 if input is hot; processor normalizes

            self.processor.process_block_rms(rms)

        # Use WASAPI exclusive/shared as available; latency "low" is fine
        self.stream = sd.InputStream(device=self.device,
                                     channels=self.channels,
                                     dtype="float32",
                                     samplerate=self.samplerate,
                                     blocksize=blocksize,
                                     latency=latency,
                                     callback=_callback)
        self.stream.start()

    def stop(self):
        if self.stream:
            self.stream.stop()
            self.stream.close()
            self.stream = None

    def get_envelope(self) -> float:
        return self.processor.get_value()
