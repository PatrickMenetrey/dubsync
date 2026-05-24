#!/bin/zsh

set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_URL="http://127.0.0.1:5173/login"
SERVER_PORT=3001
CLIENT_PORT=5173

cd "$APP_DIR"

echo "DubSync"
echo "Dossier: $APP_DIR"
echo ""

if ! command -v npm >/dev/null 2>&1; then
  echo "npm est introuvable. Installe Node.js puis relance ce fichier."
  read "?Appuie sur Entrée pour fermer..."
  exit 1
fi

start_if_needed() {
  local name="$1"
  local port="$2"
  local command="$3"
  local log_file="$4"

  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "$name est déjà lancé sur le port $port."
  else
    echo "Démarrage de $name..."
    nohup zsh -lc "cd '$APP_DIR' && $command" > "$log_file" 2>&1 &
    disown
  fi
}

start_if_needed "Serveur DubSync" "$SERVER_PORT" "npm run dev:server" "/tmp/dubsync-server.log"
start_if_needed "Client DubSync" "$CLIENT_PORT" "npm run dev:client" "/tmp/dubsync-client.log"

echo ""
echo "Attente du démarrage..."
sleep 3

open "$CLIENT_URL"

echo ""
echo "DubSync est ouvert: $CLIENT_URL"
echo "Logs serveur: /tmp/dubsync-server.log"
echo "Logs client: /tmp/dubsync-client.log"
echo ""
echo "Tu peux fermer cette fenêtre. DubSync continue de tourner en arrière-plan."
sleep 2
