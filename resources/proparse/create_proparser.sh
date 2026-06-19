#!/usr/bin/env sh
set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

echo "Compiling Proparser.java..."

javac -cp "$SCRIPT_DIR/proparse.jar:$SCRIPT_DIR/lib/*" -d "$SCRIPT_DIR" "$SCRIPT_DIR/Proparser.java"

if [ "$?" -eq 0 ]; then
    echo "Build successful."
else
    echo "Build FAILED."
    exit 1
fi
