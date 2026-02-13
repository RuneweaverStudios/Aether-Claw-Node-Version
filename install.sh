#!/bin/bash
#
# Aether-Claw Node Installer
# Cross-platform (Windows & Mac) - secure AI assistant
#
# Usage: curl -sSL https://raw.githubusercontent.com/RuneweaverStudios/Aether-Claw-Node-Version/main/install.sh | bash -s -- [OPTIONS]
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

INSTALL_DIR="${HOME}/.aether-claw-node"
REPO_URL="https://github.com/RuneweaverStudios/Aether-Claw-Node-Version.git"
BRANCH="main"
INSTALLER_RAW="https://raw.githubusercontent.com/RuneweaverStudios/Aether-Claw-Node-Version/main/install.sh"

# If this script is running from inside the install dir, re-run with latest from GitHub so options menu is always current
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
if [ -d "$INSTALL_DIR" ] && [ "$SCRIPT_DIR" = "$(cd "$INSTALL_DIR" && pwd)" ] && command -v curl &>/dev/null; then
    LATEST="$(curl -sSL "$INSTALLER_RAW" 2>/dev/null)" || true
    if [ -n "$LATEST" ] && printf '%s' "$LATEST" | grep -q 'Aether-Claw Node Installer'; then
        exec bash -c "$LATEST" -- "$@"
    fi
fi

while [[ $# -gt 0 ]]; do
    case $1 in
        --branch|-b) BRANCH="$2"; shift 2 ;;
        --dir|-d) INSTALL_DIR="$2"; shift 2 ;;
        --help|-h)
            echo "Usage: curl -sSL <url> | bash -s -- [OPTIONS]"
            echo "  --branch, -b      Git branch (default: main)"
            echo "  --dir, -d DIR     Install directory (default: ~/.aether-claw-node)"
            exit 0
            ;;
        *) shift ;;
    esac
done

echo ""
printf "${BLUE}╔════════════════════════════════════════════════════╗${NC}\n"
printf "${BLUE}║${NC} ${CYAN}           A E T H E R - C L A W   ( N O D E )           ${NC} ${BLUE}║${NC}\n"
printf "${BLUE}║${NC}   Cross-platform • Windows & Mac • OpenRouter  ${NC} ${BLUE}║${NC}\n"
printf "${BLUE}╚════════════════════════════════════════════════════╝${NC}\n"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    printf "${RED}Error: Node.js is required.${NC}\n"
    echo "Install from https://nodejs.org/ (LTS 18+) and try again."
    exit 1
fi

NODE_VERSION=$(node -v)
printf "${GREEN}✓${NC} Node $NODE_VERSION\n"

if ! command -v npm &> /dev/null; then
    printf "${RED}Error: npm is required.${NC}\n"
    exit 1
fi
printf "${GREEN}✓${NC} npm $(npm -v)\n"

# Install
printf "\n${BLUE}Installing to $INSTALL_DIR...${NC}\n"

RESTORE_ENV=""
RESTORE_CONFIG=""
RESTORE_BRAIN=""
RESTORE_SKILLS=""
WIPE_CREDS_ONLY=""

if [ -d "$INSTALL_DIR" ]; then
    # Detect existing data and show options
    printf "${YELLOW}Existing installation found at $INSTALL_DIR${NC}\n\n"

        HAS_CREDENTIALS=false
        HAS_CONFIG=false
        HAS_SESSIONS=false

        if [ -f "$INSTALL_DIR/.env" ]; then
            if grep -q "OPENROUTER_API_KEY=.\+" "$INSTALL_DIR/.env" 2>/dev/null; then
                HAS_CREDENTIALS=true
                printf "  ${GREEN}✓${NC} Credentials found (.env)\n"
            fi
        fi

        if [ -f "$INSTALL_DIR/swarm_config.json" ]; then
            HAS_CONFIG=true
            printf "  ${GREEN}✓${NC} Configuration found (swarm_config.json)\n"
        fi

        if [ -f "$INSTALL_DIR/brain/brain_index.json" ] || [ -d "$INSTALL_DIR/brain" ] && [ "$(ls -A $INSTALL_DIR/brain/*.md 2>/dev/null)" ]; then
            HAS_SESSIONS=true
            printf "  ${GREEN}✓${NC} Session data found (brain, memory)\n"
        fi
        if [ -d "$INSTALL_DIR/skills" ] && [ "$(ls -A $INSTALL_DIR/skills 2>/dev/null)" ]; then
            HAS_SESSIONS=true
            printf "  ${GREEN}✓${NC} Skills found\n"
        fi

        printf "\n"
        printf "  ${CYAN}[1]${NC} Reinstall fresh (reset everything)\n"
        printf "  ${CYAN}[2]${NC} Reset credentials only (keep config & sessions)\n"
        printf "  ${CYAN}[3]${NC} Reset config only (keep credentials & sessions)\n"
        printf "  ${CYAN}[4]${NC} Reset sessions only (keep credentials & config)\n"
        printf "  ${CYAN}[5]${NC} Reset Telegram only (keep everything else, then connect new bot)\n"
        printf "  ${CYAN}[6]${NC} Update only (fresh code, keep all data)\n"
        printf "  ${CYAN}[7]${NC} Cancel / Run existing installation\n"
        printf "\n"

        if [ -t 0 ]; then
            read -p "  Select option [1-7]: " choice
        else
            read -p "  Select option [1-7]: " choice < /dev/tty
        fi

        choice=${choice:-7}

        case "$choice" in
            1)
                printf "\n${YELLOW}Resetting everything...${NC}\n"
                rm -rf "$INSTALL_DIR"
                ;;
            2)
                printf "\n${YELLOW}Resetting credentials only...${NC}\n"
                [ -f "$INSTALL_DIR/swarm_config.json" ] && cp "$INSTALL_DIR/swarm_config.json" /tmp/aethernode-config-backup
                [ -d "$INSTALL_DIR/brain" ] && cp -r "$INSTALL_DIR/brain" /tmp/aethernode-brain-backup
                [ -d "$INSTALL_DIR/skills" ] && cp -r "$INSTALL_DIR/skills" /tmp/aethernode-skills-backup
                rm -rf "$INSTALL_DIR"
                RESTORE_CONFIG=1
                RESTORE_BRAIN=1
                RESTORE_SKILLS=1
                WIPE_CREDS_ONLY=1
                ;;
            3)
                printf "\n${YELLOW}Resetting config only...${NC}\n"
                [ -f "$INSTALL_DIR/.env" ] && cp "$INSTALL_DIR/.env" /tmp/aethernode-env-backup
                [ -d "$INSTALL_DIR/brain" ] && cp -r "$INSTALL_DIR/brain" /tmp/aethernode-brain-backup
                [ -d "$INSTALL_DIR/skills" ] && cp -r "$INSTALL_DIR/skills" /tmp/aethernode-skills-backup
                rm -rf "$INSTALL_DIR"
                RESTORE_ENV=1
                RESTORE_BRAIN=1
                RESTORE_SKILLS=1
                ;;
            4)
                printf "\n${YELLOW}Resetting sessions only...${NC}\n"
                [ -f "$INSTALL_DIR/.env" ] && cp "$INSTALL_DIR/.env" /tmp/aethernode-env-backup
                [ -f "$INSTALL_DIR/swarm_config.json" ] && cp "$INSTALL_DIR/swarm_config.json" /tmp/aethernode-config-backup
                rm -rf "$INSTALL_DIR"
                RESTORE_ENV=1
                RESTORE_CONFIG=1
                ;;
            5)
                printf "\n${YELLOW}Resetting Telegram...${NC}\n"
                if [ -f "$INSTALL_DIR/.env" ]; then
                    grep -v "TELEGRAM_BOT_TOKEN" "$INSTALL_DIR/.env" 2>/dev/null | grep -v "TELEGRAM_CHAT_ID" > "$INSTALL_DIR/.env.tmp" 2>/dev/null || true
                    [ -f "$INSTALL_DIR/.env.tmp" ] && mv "$INSTALL_DIR/.env.tmp" "$INSTALL_DIR/.env"
                fi
                printf "  Telegram configuration removed\n"
                printf "\n${CYAN}Starting Telegram onboarding (connect a new bot)...${NC}\n\n"
                cd "$INSTALL_DIR"
                node src/cli.js telegram-setup < /dev/tty
                exit 0
                ;;
            6)
                printf "\n${YELLOW}Updating code only...${NC}\n"
                [ -f "$INSTALL_DIR/.env" ] && cp "$INSTALL_DIR/.env" /tmp/aethernode-env-backup
                [ -f "$INSTALL_DIR/swarm_config.json" ] && cp "$INSTALL_DIR/swarm_config.json" /tmp/aethernode-config-backup
                [ -d "$INSTALL_DIR/brain" ] && cp -r "$INSTALL_DIR/brain" /tmp/aethernode-brain-backup
                [ -d "$INSTALL_DIR/skills" ] && cp -r "$INSTALL_DIR/skills" /tmp/aethernode-skills-backup
                rm -rf "$INSTALL_DIR"
                RESTORE_ENV=1
                RESTORE_CONFIG=1
                RESTORE_BRAIN=1
                RESTORE_SKILLS=1
                ;;
            7|*)
                printf "\n${CYAN}Using existing installation.${NC}\n\n"
                cd "$INSTALL_DIR"
                printf "${CYAN}╔════════════════════════════════════════════════════╗${NC}\n"
                printf "${CYAN}║${NC}              ${YELLOW}Ready to get started?${NC}                  ${CYAN}║${NC}\n"
                printf "${CYAN}╚════════════════════════════════════════════════════╝${NC}\n\n"
                printf "  ${CYAN}[1]${NC} Run onboarding\n"
                printf "  ${CYAN}[2]${NC} Launch TUI (chat)\n"
                printf "  ${CYAN}[3]${NC} Exit\n\n"
                if [ -t 0 ]; then
                    read -p "  Choose [1-3] (default: 2): " start_choice
                else
                    read -p "  Choose [1-3] (default: 2): " start_choice < /dev/tty
                fi
                start_choice=${start_choice:-2}
                case "$start_choice" in
                    1) node src/cli.js onboard < /dev/tty ;;
                    2) node src/cli.js tui < /dev/tty ;;
                    *) printf "  Run: ${CYAN}cd $INSTALL_DIR && node src/cli.js tui${NC}\n\n" ;;
                esac
                exit 0
                ;;
        esac
fi

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Clone or download
if command -v git &> /dev/null; then
    printf "${GREEN}✓${NC} Cloning repository...\n"
    git clone --depth 1 -b "$BRANCH" "$REPO_URL" .
else
    printf "${YELLOW}Downloading archive...${NC}\n"
    curl -sSL "https://github.com/RuneweaverStudios/Aether-Claw-Node-Version/archive/refs/heads/${BRANCH}.tar.gz" | tar -xzf - --strip-components=1 -C .
fi

# Restore backups
[ -n "$RESTORE_ENV" ] && [ -f /tmp/aethernode-env-backup ] && mv /tmp/aethernode-env-backup "$INSTALL_DIR/.env" && printf "${GREEN}✓${NC} Restored credentials\n"
[ -n "$RESTORE_CONFIG" ] && [ -f /tmp/aethernode-config-backup ] && mv /tmp/aethernode-config-backup "$INSTALL_DIR/swarm_config.json" && printf "${GREEN}✓${NC} Restored config\n"
if [ -n "$RESTORE_BRAIN" ] && [ -d /tmp/aethernode-brain-backup ]; then
    mkdir -p "$INSTALL_DIR/brain"
    cp -r /tmp/aethernode-brain-backup/* "$INSTALL_DIR/brain/" 2>/dev/null
    rm -rf /tmp/aethernode-brain-backup
    printf "${GREEN}✓${NC} Restored brain\n"
fi
if [ -n "$RESTORE_SKILLS" ] && [ -d /tmp/aethernode-skills-backup ]; then
    mkdir -p "$INSTALL_DIR/skills"
    cp -r /tmp/aethernode-skills-backup/* "$INSTALL_DIR/skills/" 2>/dev/null
    rm -rf /tmp/aethernode-skills-backup
    printf "${GREEN}✓${NC} Restored skills\n"
fi

# Credentials reset: remove API key from .env if we only wiped creds
if [ -n "$WIPE_CREDS_ONLY" ] && [ -f "$INSTALL_DIR/.env" ]; then
    grep -v "OPENROUTER_API_KEY" "$INSTALL_DIR/.env" > "$INSTALL_DIR/.env.tmp" 2>/dev/null || true
    mv "$INSTALL_DIR/.env.tmp" "$INSTALL_DIR/.env" 2>/dev/null || true
fi

# Install dependencies
printf "${GREEN}✓${NC} Running npm install...\n"
npm install --silent

printf "\n${GREEN}✓ Installation complete.${NC}\n\n"

# Interactive prompt
printf "${CYAN}╔════════════════════════════════════════════════════╗${NC}\n"
printf "${CYAN}║${NC}              ${YELLOW}Ready to get started?${NC}                  ${CYAN}║${NC}\n"
printf "${CYAN}╚════════════════════════════════════════════════════╝${NC}\n\n"

printf "  ${CYAN}[1]${NC} Run onboarding (first-time setup)\n"
printf "  ${CYAN}[2]${NC} Launch TUI (chat interface)\n"
printf "  ${CYAN}[3]${NC} Exit (run manually later)\n\n"

if [ -t 0 ]; then
    read -p "  Choose [1-3] (default: 1): " choice
else
    read -p "  Choose [1-3] (default: 1): " choice < /dev/tty
fi

choice=${choice:-1}

cd "$INSTALL_DIR"

case "$choice" in
    1)
        printf "\n${CYAN}Running onboarding...${NC}\n\n"
        node src/cli.js onboard < /dev/tty
        ;;
    2)
        printf "\n${CYAN}Launching TUI...${NC}\n\n"
        node src/cli.js tui < /dev/tty
        ;;
    3)
        printf "\n${YELLOW}Exiting. Run manually:${NC}\n"
        printf "  cd $INSTALL_DIR\n"
        printf "  node src/cli.js onboard   # first-time setup\n"
        printf "  node src/cli.js tui       # chat\n\n"
        ;;
    *)
        printf "\n${YELLOW}Invalid choice. Exiting.${NC}\n"
        printf "  Run: ${CYAN}cd $INSTALL_DIR && node src/cli.js onboard${NC}\n\n"
        ;;
esac
