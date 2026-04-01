#!/bin/sh

# Use script to create a pseudo-TTY so Expo shows the tunnel URL
# The retry loop ensures the container never exits
while true; do
  echo "Starting Expo with tunnel mode (with PTY)..."
    script -qec "npx expo start --tunnel" /dev/null 2>&1 || true
      echo "Expo process exited. Restarting in 5 seconds..."
        sleep 5
        done
        
