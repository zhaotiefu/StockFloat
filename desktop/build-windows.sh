#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p ../release
export CGO_ENABLED=1
export GOOS=windows
export GOARCH=amd64
export CC=x86_64-w64-mingw32-gcc
export CXX=x86_64-w64-mingw32-g++
go build -ldflags "-H windowsgui -s -w" -o ../release/StockFloat.exe .
echo "built ../release/StockFloat.exe"
