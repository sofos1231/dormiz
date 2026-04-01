#!/bin/sh

# Background job: find and print tunnel URL
(
  for i in $(seq 1 120); do
      sleep 3

          # Debug: check if .expo directory exists and what's in it
              if [ "$i" = "5" ] || [ "$i" = "15" ] || [ "$i" = "30" ]; then
                    echo "DEBUG: Checking .expo directory..."
                          ls -la /app/.expo/ 2>/dev/null || echo "DEBUG: /app/.expo/ does not exist"
                                if [ -f /app/.expo/packager-info.json ]; then
                                        echo "DEBUG: packager-info.json contents:"
                                                cat /app/.expo/packager-info.json 2>/dev/null
                                                      fi
                                                            # Also check home directory
                                                                  ls -la ~/.expo/ 2>/dev/null || echo "DEBUG: ~/.expo/ does not exist"
                                                                        if [ -f ~/.expo/packager-info.json ]; then
                                                                                echo "DEBUG: ~/.expo/packager-info.json contents:"
                                                                                        cat ~/.expo/packager-info.json 2>/dev/null
                                                                                              fi
                                                                                                    # Try to find any packager-info files
                                                                                                          find / -name "packager-info.json" 2>/dev/null | head -5
                                                                                                              fi
                                                                                                              
                                                                                                                  # Try to read URL from packager-info.json in multiple locations
                                                                                                                      for PDIR in /app/.expo /root/.expo /tmp/.expo; do
                                                                                                                            if [ -f "$PDIR/packager-info.json" ]; then
                                                                                                                                    URL=$(node -e "try{var i=JSON.parse(require('fs').readFileSync('$PDIR/packager-info.json','utf8'));var u=i.expoServerUrl||i.packagerNgrokUrl||i.url||'';if(u&&u.indexOf('ngrok')!==-1)console.log(u)}catch(e){}" 2>/dev/null)
                                                                                                                                            if [ -n "$URL" ]; then
                                                                                                                                                      echo ""
                                                                                                                                                                echo "============================================"
                                                                                                                                                                          echo "  EXPO TUNNEL URL: $URL"
                                                                                                                                                                                    echo "============================================"
                                                                                                                                                                                              echo ""
                                                                                                                                                                                                        echo "Open Expo Go and enter this URL to connect."
                                                                                                                                                                                                                  break 2
                                                                                                                                                                                                                          fi
                                                                                                                                                                                                                                fi
                                                                                                                                                                                                                                    done
                                                                                                                                                                                                                                    
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
