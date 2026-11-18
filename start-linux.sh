#!/bin/sh
cd "$(dirname "$0")" || exit 1

if ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))' >/dev/null 2>&1; then
    printf '%s\n' 'Python 3.9 or newer is required. Install python3 and run this script again.' >&2
    exit 1
fi

exec python3 -X utf8 server.py "$@"
