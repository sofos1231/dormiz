#!/bin/sh

# Background job: find and print tunnel URL from packager-info.json
(
  for i in $(seq 1 120); do
      sleep 3
          if [ -f /app/.expo/packager-info.json ]; then
                URL=$(node -e "try{var i=JSON.parse(require('fs').readFileSync('/app/.expo/packager-info.json','utf8'));var u=i.expoServerUrl||i.packagerNgrokUrl||'';if(u)console.log(u)}catch(e){}" 2>/dev/null)
                      if [ -n "$URL" ]; then
                              echo ""
                                      echo "============================================"
                                              echo "  EXPO TUNNEL URL: $URL"
                                                      echo "============================================"
                                                              echo ""
                                                                      echo "Open Expo Go and enter this URL to connect."
                                                                              break
                                                                                    fi
                                                                                        fi
                                                                                            echo "  ...looking for tunnel URL ($i)..."
                                                                                              done
                                                                                              ) &

                                                                                              # Run Expo with tunnel in a retry loop so the container never exits
                                                                                              while true; do
                                                                                                echo "Starting Expo with tunnel mode..."
                                                                                                  npx expo start --tunnel || true
                                                                                                    echo "Expo process exited. Restarting in 5 seconds..."
                                                                                                      sleep 5
                                                                                                      done
