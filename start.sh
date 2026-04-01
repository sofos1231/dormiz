#!/bin/sh

# Run Expo with tunnel in a retry loop so the container never exits
# Without CI=1, Expo will print the tunnel URL when it connects
while true; do
  echo "Starting Expo with tunnel mode..."
    npx expo start --tunnel 2>&1
      echo "Expo process exited. Restarting in 5 seconds..."
        sleep 5
        done
