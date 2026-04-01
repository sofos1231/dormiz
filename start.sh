#!/bin/sh

# Start Expo in the background
npx expo start --tunnel &
EXPO_PID=$!

# Wait for ngrok tunnel to be ready, then print the URL
echo "Waiting for tunnel URL..."
for i in $(seq 1 60); do
  sleep 2
    URL=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | node -e "
        let data='';
            process.stdin.on('data',c=>data+=c);
                process.stdin.on('end',()=>{
                      try{
                              const t=JSON.parse(data);
                                      if(t.tunnels && t.tunnels.length>0){
                                                console.log(t.tunnels[0].public_url);
                                                        }
                                                              }catch(e){}
                                                                  });
                                                                    " 2>/dev/null)
                                                                      if [ -n "$URL" ]; then
                                                                          echo ""
                                                                              echo "============================================"
                                                                                  echo "  EXPO TUNNEL URL: $URL"
                                                                                      echo "============================================"
                                                                                          echo ""
                                                                                              echo "Open Expo Go and enter this URL to connect."
                                                                                                  echo ""
                                                                                                      break
                                                                                                        fi
                                                                                                          echo "  ...waiting for tunnel ($i)..."
                                                                                                          done
                                                                                                          
                                                                                                          if [ -z "$URL" ]; then
                                                                                                            echo "WARNING: Could not retrieve tunnel URL from ngrok API."
                                                                                                              echo "The tunnel may still be working. Check Expo logs above."
                                                                                                              fi
                                                                                                              
                                                                                                              # Keep the container running by waiting for the Expo process
                                                                                                              wait $EXPO_PID
