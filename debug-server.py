#!/usr/bin/env python3
"""
Fieshzen Remote Debug Server
Receives WebSocket log messages from the TV app and prints them to the terminal.

Usage:
    python3 debug-server.py                  # listen on 0.0.0.0:9876
    python3 debug-server.py --port 9876
    python3 debug-server.py --host 0.0.0.0 --port 9876

Build the app with debugging enabled:
    DEBUG_HOST=192.168.1.48 DEBUG_PORT=9876 ./build.sh
    ./deploy.sh
"""
import asyncio
import json
import argparse
import sys
from datetime import datetime

try:
    import websockets
    import websockets.exceptions
except ImportError:
    print("ERROR: websockets package not installed.")
    print("Run: pip install websockets   (or activate the SAWSUBE venv)")
    sys.exit(1)

# ANSI colours
C = {
    'reset':   '\033[0m',
    'log':     '\033[0m',
    'info':    '\033[94m',    # blue
    'warn':    '\033[93m',    # yellow
    'error':   '\033[91m',    # red
    'debug':   '\033[90m',    # grey
    'trace':   '\033[90m',    # grey
    'green':   '\033[92m',
    'orange':  '\033[93m',
}


def fmt_time(ts_ms: int) -> str:
    try:
        return datetime.fromtimestamp(ts_ms / 1000).strftime('%H:%M:%S.%f')[:-3]
    except Exception:
        return '??:??:??.???'


def print_stack(stack: str, indent: str = '        '):
    for line in stack.splitlines():
        line = line.strip()
        if line:
            print(f"{indent}{line}")


async def handler(websocket):
    addr = websocket.remote_address
    print(f"{C['green']}[+] TV connected from {addr[0]}:{addr[1]}{C['reset']}")
    try:
        async for message in websocket:
            try:
                data = json.loads(message)
            except json.JSONDecodeError:
                print(f"[raw] {message}")
                continue

            t   = data.get('type', 'console')
            ts  = fmt_time(data.get('ts', 0))

            if t == 'connect':
                ua  = data.get('ua', '')
                url = data.get('url', '')
                print(f"{C['green']}[{ts}] APP CONNECTED")
                print(f"         URL: {url}")
                print(f"         UA:  {ua}{C['reset']}")

            elif t == 'console':
                level = data.get('level', 'log')
                text  = '  '.join(data.get('args', []))
                color = C.get(level, C['log'])
                label = level.upper().ljust(5)
                print(f"{color}[{ts}] {label} {text}{C['reset']}")

            elif t == 'error':
                msg   = data.get('msg', '')
                src   = data.get('src', '')
                line  = data.get('line', '')
                col   = data.get('col', '')
                stack = data.get('stack', '')
                print(f"{C['error']}[{ts}] ERROR  {msg}")
                if src:
                    print(f"         at {src}:{line}:{col}")
                if stack:
                    print_stack(stack)
                print(C['reset'], end='')

            elif t == 'unhandledrejection':
                msg   = data.get('msg', '')
                stack = data.get('stack', '')
                print(f"{C['error']}[{ts}] UNHANDLED REJECTION: {msg}")
                if stack:
                    print_stack(stack)
                print(C['reset'], end='')

            else:
                print(f"[{ts}] {data}")

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        print(f"{C['orange']}[-] TV disconnected from {addr[0]}:{addr[1]}{C['reset']}")


async def main(host: str, port: int):
    print(f"{C['green']}Fieshzen Debug Server{C['reset']}")
    print(f"Listening on  ws://{host}:{port}")
    print(f"Build command: DEBUG_HOST=<your-ip> DEBUG_PORT={port} ./build.sh")
    print(f"Then deploy and launch the app on the TV.\n")
    async with websockets.serve(handler, host, port):
        await asyncio.Future()   # run forever


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Fieshzen remote debug server')
    parser.add_argument('--host', default='0.0.0.0',
                        help='Bind address (default: 0.0.0.0)')
    parser.add_argument('--port', type=int, default=9876,
                        help='Listen port (default: 9876)')
    args = parser.parse_args()
    try:
        asyncio.run(main(args.host, args.port))
    except KeyboardInterrupt:
        print("\nDebug server stopped.")
