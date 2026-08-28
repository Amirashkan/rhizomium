#!/usr/bin/env python3
"""
collab_room_server.py - the room relay behind the collab space.

Artists in the same room send each other graph ops and pointer positions; this
process carries them and nothing else. It is deliberately a relay rather than a
server with an opinion:

  - It never parses an op. The op vocabulary lives in src/collab/ops.js and
    changes there; a relay that understood ops would need releasing in step
    with the editor, and would be a second place for the graph model to drift.
  - It holds no history. A joining peer is sent to an existing peer for a
    snapshot of the live canvas (see `snapshot.request` below), so the room's
    truth stays in the editors that are actually rendering it.
  - It keeps no state worth losing. Restarting it drops every room; the editors
    reconnect and re-adopt. That is the intended failure mode.

## What it enforces

The editor gates the collab space on the `collab.space` entitlement
(src/collab/collabGate.js), but that is a licence check in a browser the
visitor controls. The enforceable boundary is here, and there are three ways to
run it, in ascending order of what they can prove about whoever just connected:

  - **Loopback, no secrets** (the default). A local, single-machine feature.
    Anyone who can reach the port is in.
  - **`--token`**. As private as that shared token is. It says the peer was
    told the token; it says nothing about who they are or what they pay for.
  - **`--grant-secret`** (or `TIER_GRANT_SECRET`). Every peer must present a
    grant the gallery signed, naming `collab.space` and not yet expired. This
    is the one that can face the internet: the secret is shared with the
    gallery, never with the editor, so a browser cannot mint one for itself.
    See collab_grant.py, which is the Python half of api/_lib/grant.js.

A token and a grant secret can be set together; the grant is checked after the
token. Without `--grant-secret` the relay carries whoever arrives, so do not
put that configuration on a public address.
"""

import argparse
import asyncio
import json
import logging
import os
import time
import uuid
from typing import Dict, List, Optional, Set

from aiohttp import WSMsgType, web

from collab_grant import (
    COLLAB_FEATURE,
    REFUSED_INVALID,
    REFUSED_REQUIRED,
    GrantReplayGuard,
    check_admission,
)

logger = logging.getLogger('collab_room')

DEFAULT_HOST = '127.0.0.1'
DEFAULT_PORT = 8767

# A room is a group of people working on one canvas together, not an audience.
DEFAULT_ROOM_LIMIT = 8

# Each peer gets a bounded queue: a slow client must not be able to make the
# fast ones wait, and an op that is two seconds late is worse than no op at all
# because the snapshot diff will send the current truth along shortly anyway.
QUEUE_LIMIT = 64

# A snapshot of a large patch is the biggest thing that crosses this relay.
MAX_MESSAGE_BYTES = 8 * 1024 * 1024

NAME_LIMIT = 40
ROOM_NAME_LIMIT = 64


class Peer:
    """One editor's connection."""

    def __init__(self, ws: web.WebSocketResponse, room: str, name: str,
                 grant: Optional[dict] = None):
        self.ws = ws
        self.room = room
        self.name = name[:NAME_LIMIT] or 'Artist'
        self.peer_id = uuid.uuid4().hex[:12]
        self.joined_at = time.time()
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_LIMIT)
        self.dropped = 0
        # What the gallery said about this peer, when a grant was required. It
        # is kept for the operator's log and never sent to the room: the other
        # artists are entitled to a name and a pointer, not to someone's tier.
        self.grant = grant or None

    def describe(self) -> dict:
        return {'peerId': self.peer_id, 'name': self.name, 'joinedAt': self.joined_at}


class CollabRoomServer:
    """WebSocket relay, rooms keyed by name."""

    def __init__(
        self,
        host: str = DEFAULT_HOST,
        port: int = DEFAULT_PORT,
        token: Optional[str] = None,
        room_limit: int = DEFAULT_ROOM_LIMIT,
        grant_secret: Optional[str] = None,
    ):
        self.host = host
        self.port = port
        self.token = token
        self.room_limit = room_limit
        self.grant_secret = grant_secret
        self.replay_guard = GrantReplayGuard()
        self.refused_count = 0

        self.app = web.Application()
        self.runner: Optional[web.AppRunner] = None
        self.rooms: Dict[str, List[Peer]] = {}
        self._writer_tasks: Set[asyncio.Task] = set()

        self.started_at = 0.0
        self.message_count = 0
        self.dropped_count = 0

        self.app.router.add_get('/room', self.handle_websocket)
        self.app.router.add_get('/health', self.handle_health)
        self.app.router.add_get('/stats', self.handle_stats)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self):
        self.started_at = time.time()
        self.runner = web.AppRunner(self.app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, self.host, self.port)
        await site.start()
        logger.info('Collab room relay at ws://%s:%s/room', self.host, self.port)

    async def stop(self):
        for peers in list(self.rooms.values()):
            for peer in list(peers):
                await peer.ws.close()
        self.rooms.clear()
        for task in list(self._writer_tasks):
            task.cancel()
        if self.runner:
            await self.runner.cleanup()
            self.runner = None

    # ------------------------------------------------------------------
    # Fan-out
    # ------------------------------------------------------------------

    def _enqueue(self, peer: Peer, payload: dict):
        try:
            peer.queue.put_nowait(payload)
        except asyncio.QueueFull:
            # Drop the oldest rather than the newest: on a shared canvas the
            # freshest position of a node is the one worth having.
            try:
                peer.queue.get_nowait()
                peer.queue.put_nowait(payload)
            except (asyncio.QueueEmpty, asyncio.QueueFull):
                pass
            peer.dropped += 1
            self.dropped_count += 1

    def broadcast(self, room: str, payload: dict, exclude: Optional[Peer] = None):
        for peer in self.rooms.get(room, []):
            if peer is exclude:
                continue
            self._enqueue(peer, payload)

    def send_to(self, room: str, peer_id: str, payload: dict):
        for peer in self.rooms.get(room, []):
            if peer.peer_id == peer_id:
                self._enqueue(peer, payload)
                return True
        return False

    def roster(self, room: str) -> List[dict]:
        return [peer.describe() for peer in self.rooms.get(room, [])]

    async def _writer(self, peer: Peer):
        """One task per peer, draining its queue to the socket."""
        try:
            while True:
                payload = await peer.queue.get()
                if peer.ws.closed:
                    return
                await peer.ws.send_json(payload)
        except (asyncio.CancelledError, ConnectionResetError):
            return
        except Exception as exc:  # pragma: no cover - transport noise
            logger.debug('writer for %s ended: %s', peer.peer_id, exc)

    # ------------------------------------------------------------------
    # Connection handling
    # ------------------------------------------------------------------

    async def handle_websocket(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse(max_msg_size=MAX_MESSAGE_BYTES, heartbeat=30)
        await ws.prepare(request)

        if self.token and request.query.get('token') != self.token:
            await self._refuse(ws, 'bad_token', 'This relay needs the room token.')
            return ws

        peer: Optional[Peer] = None

        try:
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    data = json.loads(msg.data)
                except json.JSONDecodeError:
                    continue

                self.message_count += 1
                kind = data.get('t')

                if peer is None:
                    # Nothing is relayed before a hello: the room a message
                    # belongs to is not knowable until then.
                    if kind != 'hello':
                        continue
                    peer = await self._join(ws, data)
                    if peer is None:
                        break
                    continue

                await self._relay(peer, kind, data)
        finally:
            if peer is not None:
                self._leave(peer)

        return ws

    async def _refuse(self, ws: web.WebSocketResponse, code: str, message: str) -> None:
        """Say no in words the panel can show, then hang up."""
        self.refused_count += 1
        await ws.send_json({'t': 'error', 'code': code, 'message': message})
        await ws.close()

    def _check_grant(self, data: dict):
        """
        Decide whether this hello may enter a room, and log why not.

        The decision itself is collab_grant.check_admission — kept there so it
        can be tested without a socket. This adds the one thing a relay owes an
        operator that a pure function cannot: a line in the log saying which
        check actually failed, since the peer is deliberately not told.
        """
        payload, code, reason = check_admission(
            data.get('grant'), self.grant_secret, self.replay_guard
        )
        if code:
            logger.warning('Refused a peer: %s.', reason or code)
        return payload, code

    async def _join(self, ws: web.WebSocketResponse, data: dict) -> Optional[Peer]:
        room = str(data.get('room') or '')[:ROOM_NAME_LIMIT].strip()
        if not room:
            await self._refuse(ws, 'no_room', 'A collab session needs a room name.')
            return None

        # Entitlement before capacity, deliberately. Checking the room's size
        # first would cost one fewer grant on a full room, and would also let
        # anyone with a socket probe which room names are occupied without ever
        # proving they are entitled to be here.
        grant, refusal = self._check_grant(data)
        if refusal == REFUSED_REQUIRED:
            await self._refuse(ws, REFUSED_REQUIRED,
                               'This relay only admits accounts the gallery vouches for, and the '
                               'editor did not present a pass. Sign in to the gallery and try again.')
            return None
        if refusal:
            await self._refuse(ws, REFUSED_INVALID,
                               'The gallery pass this editor presented was not accepted. Sign in '
                               'again, then rejoin.')
            return None

        occupants = self.rooms.setdefault(room, [])
        if len(occupants) >= self.room_limit:
            await self._refuse(ws, 'room_full',
                               f'That room already has {self.room_limit} artists in it.')
            return None

        identity = data.get('identity') or {}
        peer = Peer(ws, room, str(identity.get('name') or 'Artist'), grant=grant)
        founder = len(occupants) == 0
        occupants.append(peer)

        task = asyncio.create_task(self._writer(peer))
        self._writer_tasks.add(task)
        task.add_done_callback(self._writer_tasks.discard)

        self._enqueue(peer, {
            't': 'welcome',
            'peerId': peer.peer_id,
            'room': room,
            'founder': founder,
            'peers': self.roster(room),
        })
        self.broadcast(room, {'t': 'peers', 'peers': self.roster(room)}, exclude=peer)
        logger.info('%s joined %s (%d in room)', peer.name, room, len(occupants))
        return peer

    async def _relay(self, peer: Peer, kind: str, data: dict):
        if kind == 'bye':
            await peer.ws.close()
            return

        if kind in ('ops', 'cursor'):
            self.broadcast(peer.room, {**data, 'from': peer.peer_id}, exclude=peer)
            return

        if kind == 'snapshot.request':
            # Ask the peer who has been in the room longest and is not the one
            # asking. Asking everyone would have a large patch sent several
            # times over for one joiner.
            others = [p for p in self.rooms.get(peer.room, []) if p is not peer]
            if others:
                self._enqueue(others[0], {'t': 'snapshot.request', 'from': peer.peer_id})
            else:
                # The room emptied between hello and here: this peer is now the
                # founder, and its own canvas is the room's.
                self._enqueue(peer, {'t': 'welcome', 'peerId': peer.peer_id, 'room': peer.room,
                                     'founder': True, 'peers': self.roster(peer.room)})
            return

        if kind == 'snapshot':
            target = data.get('to')
            if target:
                self.send_to(peer.room, str(target), {'t': 'snapshot',
                                                      'from': peer.peer_id,
                                                      'snapshot': data.get('snapshot')})
            return

    def _leave(self, peer: Peer):
        occupants = self.rooms.get(peer.room)
        if not occupants:
            return
        if peer in occupants:
            occupants.remove(peer)
        if occupants:
            self.broadcast(peer.room, {'t': 'peers', 'peers': self.roster(peer.room)})
        else:
            del self.rooms[peer.room]
        logger.info('%s left %s', peer.name, peer.room)

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    async def handle_health(self, _request: web.Request) -> web.Response:
        return web.json_response({
            'status': 'ok',
            'rooms': len(self.rooms),
            # Advertised so an operator (or a panel showing a relay's address)
            # can tell a gated relay from an open one without trying to join.
            # It is a description, not a secret: what it protects is the
            # signing key, which never leaves the server.
            'grantRequired': bool(self.grant_secret),
        })

    async def handle_stats(self, _request: web.Request) -> web.Response:
        return web.json_response({
            'uptime': time.time() - self.started_at if self.started_at else 0,
            'rooms': {name: len(peers) for name, peers in self.rooms.items()},
            'messages': self.message_count,
            'dropped': self.dropped_count,
            'refused': self.refused_count,
            'tokenRequired': bool(self.token),
            'grantRequired': bool(self.grant_secret),
        })


_server: Optional[CollabRoomServer] = None


def get_server(**kwargs) -> CollabRoomServer:
    """The process-wide relay, created on first use (mirrors the OSC bridge)."""
    global _server
    if _server is None:
        _server = CollabRoomServer(**kwargs)
    return _server


async def _run(args):
    server = get_server(host=args.host, port=args.port, token=args.token,
                        room_limit=args.room_limit, grant_secret=args.grant_secret)
    await server.start()
    try:
        while True:
            await asyncio.sleep(3600)
    except asyncio.CancelledError:
        await server.stop()


def main():
    parser = argparse.ArgumentParser(description='Rhizomium collab room relay')
    parser.add_argument('--host', default=DEFAULT_HOST)
    parser.add_argument('--port', type=int, default=DEFAULT_PORT)
    parser.add_argument('--token', default=None,
                        help='Shared secret every peer must present as ?token=')
    parser.add_argument('--room-limit', type=int, default=DEFAULT_ROOM_LIMIT)
    parser.add_argument('--grant-secret', default=os.environ.get('TIER_GRANT_SECRET'),
                        help='The gallery\'s grant-signing secret. When set, every peer must '
                             'present a signed grant naming ' + COLLAB_FEATURE + '. Defaults to '
                             '$TIER_GRANT_SECRET; prefer the environment over the command line, '
                             'which other processes can read.')
    parser.add_argument('--verbose', action='store_true')
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format='%(asctime)s %(levelname)s %(message)s')

    if args.grant_secret:
        logger.info('Admitting only peers with a gallery-signed %s grant.', COLLAB_FEATURE)
    elif args.host not in ('127.0.0.1', 'localhost', '::1'):
        # Not fatal — a LAN relay behind a shared token is a legitimate way to
        # run this — but an unauthenticated relay on a routable address is
        # worth one loud line in the log rather than a silent surprise.
        logger.warning('Listening on %s with no grant secret: anyone who can reach this port '
                       'can join a room.%s', args.host,
                       '' if args.token else ' Not even a room token is set.')
    try:
        asyncio.run(_run(args))
    except KeyboardInterrupt:
        print('\nCollab room relay stopped.')


if __name__ == '__main__':
    main()
