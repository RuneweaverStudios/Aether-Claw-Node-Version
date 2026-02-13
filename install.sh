#!/bin/bash
#
# Aether-Claw Installer
# Secure, swarm-based AI assistant with cryptographic skill signing
#
# Usage: curl -sSL https://raw.githubusercontent.com/RuneweaverStudios/aetherclaw/main/install.sh | bash -s -- [OPTIONS]
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Defaults
INSTALL_DIR="${HOME}/.aether-claw"
REPO_URL="https://github.com/RuneweaverStudios/aetherclaw.git"
BRANCH="main"
FORCE=false

# Parse arguments FIRST before anything else
while [[ $# -gt 0 ]]; do
    case $1 in
        --force|-f)
            FORCE=true
            shift
            ;;
        --branch|-b)
            BRANCH="$2"
            shift 2
            ;;
        --dir|-d)
            INSTALL_DIR="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: curl -sSL <url> | bash -s -- [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --force, -f           Force reinstall if already exists"
            echo "  --branch, -b BRANCH   Git branch to install (default: main)"
            echo "  --dir, -d DIR         Installation directory (default: ~/.aether-claw)"
            echo "  --help, -h            Show this help message"
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

# Banner (no ANSI in middle of lines)
echo ""
printf "${BLUE}╔════════════════════════════════════════════════════╗${NC}\n"
printf "${BLUE}║${NC} ${CYAN}                A E T H E R C L A W                 ${NC} ${BLUE}║${NC}\n"
printf "${BLUE}║${NC}   ───────────────────────────────────────────────  ${BLUE}║${NC}\n"
printf "${BLUE}║${NC}      Secure Swarm-Based Second Brain / Agent      ${NC} ${BLUE}║${NC}\n"
printf "${BLUE}║${NC}   Local • Cryptographically Signed Skills • Memory${NC} ${BLUE}║${NC}\n"
printf "${BLUE}╚════════════════════════════════════════════════════╝${NC}\n"
echo ""
printf "${CYAN}   █████╗ ███████╗████████╗██╗  ██╗███████╗██████╗${NC}\n"
printf "${CYAN}  ██╔══██╗██╔════╝╚══██╔══╝██║  ██║██╔════╝██╔══██╗${NC}\n"
printf "${CYAN}  ███████║█████╗     ██║   ███████║█████╗  ██████╔╝${NC}\n"
printf "${CYAN}  ██╔══██║██╔══╝     ██║   ██╔══██║██╔══╝  ██╔══██╗${NC}\n"
printf "${CYAN}  ██║  ██║███████╗   ██║   ██║  ██║███████╗██║  ██║${NC}\n"
printf "${CYAN}  ╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝${NC}\n"
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    printf "${RED}Error: Python 3 is required but not installed.${NC}\n"
    echo "Please install Python 3.8+ and try again."
    exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
printf "${GREEN}✓${NC} Python $PYTHON_VERSION found\n"

# Check pip
if ! command -v pip3 &> /dev/null; then
    printf "${RED}Error: pip3 is required but not installed.${NC}\n"
    exit 1
fi
printf "${GREEN}✓${NC} pip found\n"

# Create installation directory
printf "\n${BLUE}Installing Aether-Claw...${NC}\n"

if [ -d "$INSTALL_DIR" ]; then
    if [ "$FORCE" = true ]; then
        printf "${YELLOW}Removing existing installation...${NC}\n"
        rm -rf "$INSTALL_DIR"
    else
        # Detect existing data
        printf "${YELLOW}Existing installation found at $INSTALL_DIR${NC}\n\n"

        HAS_CREDENTIALS=false
        HAS_CONFIG=false
        HAS_SESSIONS=false
        HAS_KEYS=false

        # Check for credentials
        if [ -f "$INSTALL_DIR/.env" ]; then
            if grep -q "OPENROUTER_API_KEY=.\+" "$INSTALL_DIR/.env" 2>/dev/null || \
               grep -q "GLM_API_KEY=.\+" "$INSTALL_DIR/.env" 2>/dev/null; then
                HAS_CREDENTIALS=true
                printf "  ${GREEN}✓${NC} Credentials found (.env)\n"
            fi
        fi

        # Check for RSA keys
        if [ -f "$HOME/.claude/secure/private_key.pem" ]; then
            HAS_KEYS=true
            printf "  ${GREEN}✓${NC} RSA keys found (~/.claude/secure/)\n"
        fi

        # Check for config
        if [ -f "$INSTALL_DIR/swarm_config.json" ]; then
            HAS_CONFIG=true
            printf "  ${GREEN}✓${NC} Configuration found (swarm_config.json)\n"
        fi

        # Check for sessions/data
        if [ -f "$INSTALL_DIR/brain/brain_index.db" ] || \
           [ -d "$INSTALL_DIR/skills" ] && [ "$(ls -A $INSTALL_DIR/skills 2>/dev/null)" ]; then
            HAS_SESSIONS=true
            printf "  ${GREEN}✓${NC} Session data found (brain index, skills)\n"
        fi

        printf "\n"
        printf "  ${CYAN}[1]${NC} Reinstall fresh (reset everything)\n"
        printf "  ${CYAN}[2]${NC} Reset credentials only (keep config & sessions)\n"
        printf "  ${CYAN}[3]${NC} Reset config only (keep credentials & sessions)\n"
        printf "  ${CYAN}[4]${NC} Reset sessions only (keep credentials & config)\n"
        printf "  ${CYAN}[5]${NC} Update only (fresh code, keep all data)\n"
        printf "  ${CYAN}[6]${NC} Cancel / Run existing installation\n"
        printf "\n"

        read -p "  Select option [1-6]: " choice
        case $choice in
            1)
                printf "\n${YELLOW}Resetting everything...${NC}\n"
                rm -rf "$INSTALL_DIR"
                rm -rf "$HOME/.claude/secure/private_key.pem" 2>/dev/null
                rm -rf "$HOME/.claude/secure/public_key.pem" 2>/dev/null
                ;;
            2)
                printf "\n${YELLOW}Resetting credentials...${NC}\n"
                # Backup and remove .env
                if [ -f "$INSTALL_DIR/.env" ]; then
                    mv "$INSTALL_DIR/.env" "$INSTALL_DIR/.env.backup"
                fi
                # Remove everything else and restore
                TEMP_ENV="$INSTALL_DIR/.env.backup"
                rm -rf "$INSTALL_DIR"
                mkdir -p "$INSTALL_DIR"
                if [ -f "$TEMP_ENV" ]; then
                    # Create clean .env without API keys
                    grep -v "API_KEY" "$TEMP_ENV" > "$INSTALL_DIR/.env" 2>/dev/null || true
                    rm -f "$TEMP_ENV"
                fi
                ;;
            3)
                printf "\n${YELLOW}Resetting config...${NC}\n"
                # Backup credentials and sessions
                cp "$INSTALL_DIR/.env" "/tmp/aetherclaw-env-backup" 2>/dev/null
                cp -r "$INSTALL_DIR/skills" "/tmp/aetherclaw-skills-backup" 2>/dev/null
                cp "$INSTALL_DIR/brain/brain_index.db" "/tmp/aetherclaw-db-backup" 2>/dev/null
                # Remove and restore
                rm -rf "$INSTALL_DIR"
                mkdir -p "$INSTALL_DIR"
                mv "/tmp/aetherclaw-env-backup" "$INSTALL_DIR/.env" 2>/dev/null
                mkdir -p "$INSTALL_DIR/skills"
                mv "/tmp/aetherclaw-skills-backup"/* "$INSTALL_DIR/skills/" 2>/dev/null
                mkdir -p "$INSTALL_DIR/brain"
                mv "/tmp/aetherclaw-db-backup" "$INSTALL_DIR/brain/brain_index.db" 2>/dev/null
                ;;
            4)
                printf "\n${YELLOW}Resetting sessions...${NC}\n"
                rm -f "$INSTALL_DIR/brain/brain_index.db"
                rm -rf "$INSTALL_DIR/skills"/*
                printf "  Session data cleared\n"
                # Continue with update
                ;;
            5)
                printf "\n${YELLOW}Updating code only...${NC}\n"
                # Backup everything
                cp "$INSTALL_DIR/.env" "/tmp/aetherclaw-env-backup" 2>/dev/null
                cp "$INSTALL_DIR/swarm_config.json" "/tmp/aetherclaw-config-backup" 2>/dev/null
                # Remove and we'll restore after clone
                rm -rf "$INSTALL_DIR"
                mkdir -p "$INSTALL_DIR"
                ;;
            6|*)
                printf "\n${CYAN}Running existing installation...${NC}\n"
                export PATH="$HOME/.local/bin:$PATH"
                cd "$INSTALL_DIR"
                python3 aether_claw.py onboard
                exit 0
                ;;
        esac
    fi
fi

# Clone repository
if command -v git &> /dev/null; then
    printf "${GREEN}✓${NC} Cloning repository...\n"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR" 2>/dev/null || {
        printf "${YELLOW}!${NC} Downloading archive...\n"
        TEMP_DIR=$(mktemp -d)
        curl -sSL "https://github.com/RuneweaverStudios/aetherclaw/archive/refs/heads/$BRANCH.tar.gz" | tar -xzf - -C "$TEMP_DIR"
        mv "$TEMP_DIR/aetherclaw-$BRANCH" "$INSTALL_DIR"
        rm -rf "$TEMP_DIR"
    }
else
    printf "${YELLOW}!${NC} Downloading archive...\n"
    TEMP_DIR=$(mktemp -d)
    curl -sSL "https://github.com/RuneweaverStudios/aetherclaw/archive/refs/heads/$BRANCH.tar.gz" | tar -xzf - -C "$TEMP_DIR"
    mv "$TEMP_DIR/aetherclaw-$BRANCH" "$INSTALL_DIR"
    rm -rf "$TEMP_DIR"
fi

# Restore backed up files if they exist
if [ -f "/tmp/aetherclaw-env-backup" ]; then
    mv "/tmp/aetherclaw-env-backup" "$INSTALL_DIR/.env"
    printf "${GREEN}✓${NC} Restored credentials\n"
fi
if [ -f "/tmp/aetherclaw-config-backup" ]; then
    mv "/tmp/aetherclaw-config-backup" "$INSTALL_DIR/swarm_config.json"
    printf "${GREEN}✓${NC} Restored config\n"
fi
if [ -d "/tmp/aetherclaw-skills-backup" ]; then
    mkdir -p "$INSTALL_DIR/skills"
    cp -r "/tmp/aetherclaw-skills-backup"/* "$INSTALL_DIR/skills/" 2>/dev/null
    rm -rf "/tmp/aetherclaw-skills-backup"
    printf "${GREEN}✓${NC} Restored skills\n"
fi
if [ -f "/tmp/aetherclaw-db-backup" ]; then
    mkdir -p "$INSTALL_DIR/brain"
    mv "/tmp/aetherclaw-db-backup" "$INSTALL_DIR/brain/brain_index.db"
    printf "${GREEN}✓${NC} Restored memory index\n"
fi

# Install dependencies
printf "${GREEN}✓${NC} Installing dependencies...\n"
cd "$INSTALL_DIR"
pip3 install -q cryptography bandit plyer streamlit pyyaml psutil rich python-dotenv 2>/dev/null || {
    printf "${RED}Error installing dependencies.${NC}\n"
    exit 1
}

# Create aetherclaw command
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"

cat > "$BIN_DIR/aetherclaw" << 'CMD_EOF'
#!/bin/bash
cd "$HOME/.aether-claw" 2>/dev/null || cd "$(dirname "$0")/../.aether-claw"
python3 aether_claw.py "$@"
CMD_EOF
chmod +x "$BIN_DIR/aetherclaw"

# Add to PATH
NEED_RELOAD=false
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    SHELL_RC=""
    if [ -n "$ZSH_VERSION" ]; then
        SHELL_RC="$HOME/.zshrc"
    elif [ -n "$BASH_VERSION" ]; then
        SHELL_RC="$HOME/.bashrc"
    fi

    if [ -n "$SHELL_RC" ]; then
        # Check if already in shell rc
        if ! grep -q '.local/bin' "$SHELL_RC" 2>/dev/null; then
            echo "" >> "$SHELL_RC"
            echo "# Aether-Claw" >> "$SHELL_RC"
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
        fi
        printf "${GREEN}✓${NC} Added to PATH\n"
        NEED_RELOAD=true
    fi
fi

# Create .env template
if [ ! -f "$INSTALL_DIR/.env" ]; then
    cat > "$INSTALL_DIR/.env" << 'ENV_EOF'
# Aether-Claw Environment Configuration

# OpenRouter API Key (recommended)
OPENROUTER_API_KEY=

# Alternative: Z.ai GLM API Key
GLM_API_KEY=

# Telegram Integration (optional)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
ENV_EOF
    printf "${GREEN}✓${NC} Created .env template\n"
fi

printf "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
printf "${GREEN}✓ Aether-Claw installed!${NC}\n"
printf "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
printf "\n${BLUE}Location:${NC} $INSTALL_DIR\n"

# Add to current session PATH immediately
export PATH="$BIN_DIR:$PATH"

printf "\n${YELLOW}Next:${NC}\n"
printf "  ${CYAN}aetherclaw onboard${NC}\n"
printf "\n"

# Run onboard in a new interactive shell so stdin works
exec $SHELL -c "cd $INSTALL_DIR && python3 aether_claw.py onboard"
