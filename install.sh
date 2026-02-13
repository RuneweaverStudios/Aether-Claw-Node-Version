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
FORCE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --force|-f) FORCE=true; shift ;;
        --branch|-b) BRANCH="$2"; shift 2 ;;
        --dir|-d) INSTALL_DIR="$2"; shift 2 ;;
        --help|-h)
            echo "Usage: curl -sSL <url> | bash -s -- [OPTIONS]"
            echo "  --force, -f       Force reinstall"
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

if [ -d "$INSTALL_DIR" ]; then
    if [ "$FORCE" = true ]; then
        printf "${YELLOW}Removing existing installation...${NC}\n"
        rm -rf "$INSTALL_DIR"
    else
        printf "${YELLOW}Existing installation at $INSTALL_DIR${NC}\n"
        printf "  Use --force to reinstall\n\n"
        printf "  Run: ${CYAN}cd $INSTALL_DIR && node src/cli.js tui${NC}\n"
        exit 0
    fi
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

# Install dependencies
printf "${GREEN}✓${NC} Running npm install...\n"
npm install --silent

printf "\n${GREEN}✓ Installation complete.${NC}\n\n"
printf "  ${CYAN}Quick start:${NC}\n"
printf "    cd $INSTALL_DIR\n"
printf "    node src/cli.js onboard   # first-time setup\n"
printf "    node src/cli.js tui       # chat\n\n"
printf "  Or add to PATH and run: ${CYAN}aetherclaw-node tui${NC}\n\n"
