import numpy as np
from multiprocessing.shared_memory import SharedMemory


class SharedFrameChannel:
    """Shared memory channel for frame data transfer."""

    def __init__(self, name="rhizo_frame", size=None, create=False):
        """Initialize shared frame channel.

        Args:
            name: Name of the shared memory segment
            size: Size of shared memory (required if create=True)
            create: Whether to create new shared memory or attach to existing
        """
        if create:
            self.shm = SharedMemory(create=True, size=size, name=name)
        else:
            self.shm = SharedMemory(name=name)
        self.size = size or self.shm.size

    def send_frame(self, data: bytes):
        """Send frame data to shared memory.

        Args:
            data: Frame data as bytes
        """
        np.copyto(
            np.frombuffer(self.shm.buf, dtype=np.uint8),
            np.frombuffer(data, dtype=np.uint8)
        )

    def recv_frame(self):
        """Receive frame data from shared memory.

        Returns:
            Frame data as numpy array
        """
        return np.frombuffer(self.shm.buf, dtype=np.uint8)

    def close(self):
        """Close and unlink shared memory."""
        self.shm.close()
        try:
            self.shm.unlink()
        except:
            pass
