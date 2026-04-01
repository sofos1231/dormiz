#!/bin/sh

LOGFILE=/tmp/expo.log

# Start Expo with tunnel, capturing all output
npx expo start --tunnel 2>&1 | tee "$LOGFILE" &
EXPO_PID=$!

# Wait for the tunnel URL to appear in Expo's output
echo "Waiting for Expo tunnel URL..."
for i in $(seq 1 90); do
  sleep 2
    # Look for tunnel URL pattern in expo output
      URL=$(grep -oE 'https?://[a-zA-Z0-9._-]+\.ngrok[a-zA-Z0-9._/-]*' "$LOGFILE" 2>/dev/null | head -1)
        if [ -z "$URL" ]; then
            # Also try exp:// pattern
                URL=$(grep -oE 'exp://[a-zA-Z0-9._:/-]+' "$LOGFILE" 2>/dev/null | head -1)
                  fi
                    if [ -n "$URL" ]; then
                        echo ""
                            echo "============================================"
                                echo "  EXPO TUNNEL URL: $URL"
                                    echo "============================================"
                                        echo ""
                                            echo "Open Expo Go on your phone and enter this URL."
                                                echo ""
                                                    break
                                                      fi
                                                        # Check if tunnel connected but URL not in output, try Metro API
                                                          if grep -q "Tunnel ready" "$LOGFILE" 2>/dev/null; then
                                                              METRO_URL=$(curl -s http://127.0.0.1:8081/status 2>/dev/null)
                                                                  if [ -n "$METRO_URL" ]; then
                                                                        echo "Metro bundler is running. Tunnel is ready."
                                                                              echo "Trying to get URL from Expo config..."
                                                                                    # Try reading from .expo directory
                                                                                          CONFIG_URL=$(cat /app/.expo/packager-info.json 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.expoServerUrl||j.packagerNgrokUrl||'')}catch(e){}})" 2>/dev/null)
                                                                                                if [ -n "$CONFIG_URL" ]; then
                                                                                                        echo ""
                                                                                                                echo "============================================"
                                                                                                                        echo "  EXPO TUNNEL URL: $CONFIG_URL"
                                                                                                                                echo "============================================"
                                                                                                                                        echo ""
                                                                                                                                                break
                                                                                                                                                      fi
                                                                                                                                                          fi
                                                                                                                                                            fi
                                                                                                                                                              echo "  ...waiting ($i)..."
                                                                                                                                                              done
                                                                                                                                                              
                                                                                                                                                              # Keep running
                                                                                                                                                              wait $EXPO_PID
