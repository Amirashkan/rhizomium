import struct
import time

# Command constants
CMD_INIT = 0
CMD_FRAME = 1
CMD_PING = 2
CMD_PONG = 3
CMD_CLOSE = 4

# Frame header: cmd, width, height, timestamp, size
FrameHeader = struct.Struct("IIQII")


def pack_frame(width, height, data):
    """Pack a frame with header information.

    Args:
        width: Frame width in pixels
        height: Frame height in pixels
        data: Frame data as bytes

    Returns:
        Packed frame with header
    """
    ts = int(time.time() * 1000)
    return FrameHeader.pack(CMD_FRAME, width, height, ts, len(data)) + data
