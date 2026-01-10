"""Windows helpers for toggling always-on-top for the UI window."""
from __future__ import annotations

import sys
from typing import Tuple


def set_always_on_top(enabled: bool, title_substr: str) -> Tuple[bool, str]:
    if not sys.platform.startswith("win"):
        return False, "unsupported_platform"

    try:
        import ctypes
        from ctypes import wintypes
    except Exception:
        return False, "ctypes_unavailable"

    user32 = ctypes.windll.user32

    EnumWindows = user32.EnumWindows
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    GetWindowTextW = user32.GetWindowTextW
    GetWindowTextLengthW = user32.GetWindowTextLengthW
    IsWindowVisible = user32.IsWindowVisible
    SetWindowPos = user32.SetWindowPos

    HWND_TOPMOST = wintypes.HWND(-1)
    HWND_NOTOPMOST = wintypes.HWND(-2)
    SWP_NOSIZE = 0x0001
    SWP_NOMOVE = 0x0002
    SWP_SHOWWINDOW = 0x0040

    target = None
    needle = (title_substr or "").lower()

    def _enum_proc(hwnd, _):
        nonlocal target
        if not IsWindowVisible(hwnd):
            return True
        length = GetWindowTextLengthW(hwnd)
        if length == 0:
            return True
        buff = ctypes.create_unicode_buffer(length + 1)
        GetWindowTextW(hwnd, buff, length + 1)
        title = buff.value.lower()
        if needle and needle in title:
            target = hwnd
            return False
        return True

    EnumWindows(EnumWindowsProc(_enum_proc), 0)

    if not target:
        return False, "window_not_found"

    insert_after = HWND_TOPMOST if enabled else HWND_NOTOPMOST
    ok = bool(SetWindowPos(target, insert_after, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW))
    return (ok, "ok" if ok else "set_window_pos_failed")
