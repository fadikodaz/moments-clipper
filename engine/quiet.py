"""
Keep helper programs (FFmpeg, yt-dlp) from opening console windows on Windows.

The website starts the engine in the background without a window, so Windows would give every
program the engine starts its own new console window. Closing one of those windows also kills
that cut. Importing this module once makes every subprocess start hidden.
"""

import subprocess
import sys

if sys.platform == "win32":
    _NO_WINDOW = subprocess.CREATE_NO_WINDOW
    _original_init = subprocess.Popen.__init__

    def _hidden_init(self, *args, **kwargs):
        kwargs["creationflags"] = kwargs.get("creationflags", 0) | _NO_WINDOW
        _original_init(self, *args, **kwargs)

    subprocess.Popen.__init__ = _hidden_init  # type: ignore[method-assign]
