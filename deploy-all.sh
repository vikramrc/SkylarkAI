#!/bin/bash

# Exit on error
set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Paths
SKYLARK_ROOT=$(pwd)
FRONTEND_DIR="${SKYLARK_ROOT}/frontend"
BACKEND_DIR="${SKYLARK_ROOT}/backend"
DEPLOY_ZIP="${SKYLARK_ROOT}/deploy.zip"

# Parse arguments
CREATE_PACKAGE=false
DEPLOY_TO_REMOTE=false
REMOTE_USER="azureuser"
REMOTE_IP=""
REMOTE_KEY=""
REMOTE_PATH="/home/azureuser/maximapmx/skylark"

for arg in "$@"; do
  case $arg in
    --create-package)
      CREATE_PACKAGE=true
      shift
      ;;
    --deploy-to-remote)
      DEPLOY_TO_REMOTE=true
      CREATE_PACKAGE=true  # Need package for remote
      shift
      ;;
    --remote-user=*)
      REMOTE_USER="${arg#*=}"
      shift
      ;;
    --remote-ip=*)
      REMOTE_IP="${arg#*=}"
      shift
      ;;
    --remote-key=*)
      REMOTE_KEY="${arg#*=}"
      shift
      ;;
    --remote-path=*)
      REMOTE_PATH="${arg#*=}"
      shift
      ;;
    *)
      # Unknown
      ;;
  esac
done

# Validate dirs
if [ ! -d "$FRONTEND_DIR" ]; then
  echo -e "${RED}Error: Frontend directory not found at ${FRONTEND_DIR}${NC}"
  exit 1
fi
if [ ! -d "$BACKEND_DIR" ]; then
  echo -e "${RED}Error: Backend directory not found at ${BACKEND_DIR}${NC}"
  exit 1
fi

echo -e "${GREEN}=== SkylarkAI Deployment Tool ===${NC}"
echo ""

# Step 1: Build Frontend
echo -e "${GREEN}Step 1: Building frontend${NC}"
cd "$FRONTEND_DIR"

echo "Installing frontend dependencies..."
npm install

echo "Building Vite React app for production..."
# Build with absolute VITE_API_BASE_URL depending on environment. 
# Defaults to relative path or / if absolute is not required due to monolithic server block.
NODE_ENV=production npm run build

if [ ! -d "dist" ]; then
  echo -e "${RED}Error: Frontend build failed - dist directory not found${NC}"
  exit 1
fi
echo -e "${GREEN}Frontend build complete!${NC}\n"

# Step 2: Build Backend
echo -e "${GREEN}Step 2: Building backend${NC}"
cd "$BACKEND_DIR"

echo "Installing backend dependencies..."
npm install

echo "Compiling Typescript..."
npm run build

if [ ! -d "dist" ]; then
  echo -e "${RED}Error: Backend build failed - dist directory not found${NC}"
  exit 1
fi
echo -e "${GREEN}Backend build complete!${NC}\n"

# Step 3: Copy Frontend to Backend
echo -e "${GREEN}Step 3: Copying frontend to backend bundle${NC}"
mkdir -p "$BACKEND_DIR/public"
rm -rf "$BACKEND_DIR/public/*"
cp -r "$FRONTEND_DIR/dist/"* "$BACKEND_DIR/public/"

echo -e "${GREEN}Frontend bundled successfully!${NC}\n"

# Step 4: Create package
if [ "$CREATE_PACKAGE" = true ]; then
  echo -e "${GREEN}Step 4: Creating deployment package${NC}"
  cd "$BACKEND_DIR"
  
  TEMP_PACKAGE_DIR="${SKYLARK_ROOT}/temp_package"
  rm -rf "$TEMP_PACKAGE_DIR"
  mkdir -p "$TEMP_PACKAGE_DIR"
  
  echo "Copying backend files to package..."
  cp -r dist "$TEMP_PACKAGE_DIR/"
  cp package.json "$TEMP_PACKAGE_DIR/"
  cp package-lock.json "$TEMP_PACKAGE_DIR/"
  cp -r public "$TEMP_PACKAGE_DIR/"
  
  if [ -f ".env.production" ]; then
    cp .env.production "$TEMP_PACKAGE_DIR/"
    echo "Copied existing .env.production file"
  elif [ -f ".env" ]; then
    cp .env "$TEMP_PACKAGE_DIR/.env.production"
    echo "Copied local .env as .env.production for package"
  fi

  if [ -f "$TEMP_PACKAGE_DIR/.env.production" ]; then
    echo "" >> "$TEMP_PACKAGE_DIR/.env.production"
    echo "PHOENIX_CONTRACT_PATH=/home/azureuser/maximapmx/phoenix/constants/mcp.capabilities.contract.js" >> "$TEMP_PACKAGE_DIR/.env.production"
    echo "PHOENIX_CLOUD_URL=http://localhost:3000" >> "$TEMP_PACKAGE_DIR/.env.production"
    echo "Injected remote contract path and cloud URL into .env.production"
  fi

  if [ ! -f ".env" ] && [ ! -f ".env.production" ]; then
    echo -e "${YELLOW}Warning: No .env or .env.production file found in backend${NC}"
  fi

  if [ -d "scripts" ]; then
    cp -r scripts "$TEMP_PACKAGE_DIR/"
  fi

  if [ -d "seed" ]; then
    cp -r seed "$TEMP_PACKAGE_DIR/"
    echo "Copied seed folder"
  fi

  cd "$TEMP_PACKAGE_DIR"
  zip -r "$DEPLOY_ZIP" .
  
  cd "$SKYLARK_ROOT"
  rm -rf "$TEMP_PACKAGE_DIR"

  echo -e "${GREEN}Deployment package created: ${DEPLOY_ZIP}${NC}\n"
fi

# Step 5: Deploy to Remote
if [ "$DEPLOY_TO_REMOTE" = true ]; then
  echo -e "${GREEN}Step 5: Deploying to remote server${NC}"

  if [ -z "$REMOTE_IP" ]; then
    echo -e "${RED}Error: Remote IP address not provided. Use --remote-ip=IP${NC}"
    exit 1
  fi

  echo "Creating remote deployment script..."
  cat > "${SKYLARK_ROOT}/remote-deploy.sh" << 'EOL'
#!/bin/bash
set -e
APP_DIR="$1"
BACKUP_DIR="${1}_old"
TEMP_DIR="${1}_new"
PARENT_DIR=$(dirname "$APP_DIR")

if [ -z "$APP_DIR" ]; then
  echo "Error: Deployment path not provided"
  exit 1
fi

echo "Creating temporary directory..."
mkdir -p "$TEMP_DIR"

echo "Extracting deployment package..."
unzip -o ./skylark-deploy.zip -d "$TEMP_DIR"

echo "Installing dependencies..."
cd "$TEMP_DIR"
npm install --omit=dev --legacy-peer-deps

echo "Installing pm2-logrotate if missing..."
if ! pm2 ls | grep -q "pm2-logrotate"; then
  echo "Installing pm2-logrotate..."
  pm2 install pm2-logrotate
  pm2 set pm2-logrotate:max_size 10M
  pm2 set pm2-logrotate:retain 30
else
  echo "pm2-logrotate already installed."
fi

echo "Deleting existing SkylarkAI process..."
pm2 delete skylarkai || true

echo "Creating backup of existing deployment..."
if [ -d "$APP_DIR" ]; then
  rm -rf "$BACKUP_DIR"
  mv "$APP_DIR" "$BACKUP_DIR"
fi

echo "Moving new deployment to final location..."
mv "$TEMP_DIR" "$APP_DIR"

if [ -d "$BACKUP_DIR/logs" ]; then
  echo "Preserving logs folder..."
  rm -rf "$APP_DIR/logs"
  cp -r "$BACKUP_DIR/logs" "$APP_DIR/"
else
  mkdir -p "$APP_DIR/logs"
fi

echo "Populating Qdrant vector indexes..."
cd "$APP_DIR"
npm run index:qdrant:prod
npm run index:qdrant:collections:prod

echo "Starting SkylarkAI with PM2..."
# Starts using compiled main: dist/src/index.js
if pm2 describe skylarkai >/dev/null 2>&1; then
  echo "Restarting with updated environment..."
  NODE_ENV=production pm2 restart skylarkai --update-env --output "$APP_DIR/logs/out.log" --error "$APP_DIR/logs/error.log" --time
else
  echo "Starting fresh..."
  NODE_ENV=production pm2 start dist/src/index.js --name skylarkai --output "$APP_DIR/logs/out.log" --error "$APP_DIR/logs/error.log" --time
fi

echo "Saving PM2 configuration..."
pm2 save

echo ""
echo "=== SkylarkAI Deployment completed successfully! ==="
EOL

  echo "Transferring files to remote server..."
  SCP_CMD="scp"
  SSH_CMD="ssh"
  if [ ! -z "$REMOTE_KEY" ]; then
    SCP_CMD="scp -i $REMOTE_KEY"
    SSH_CMD="ssh -i $REMOTE_KEY"
  fi

  PARENT_DIR=$(dirname "${REMOTE_PATH}")
  $SSH_CMD "${REMOTE_USER}@${REMOTE_IP}" "mkdir -p \"${PARENT_DIR}\""

  echo "Transferring deployment package..."
  $SCP_CMD "${DEPLOY_ZIP}" "${REMOTE_USER}@${REMOTE_IP}:${PARENT_DIR}/skylark-deploy.zip"

  echo "Transferring deployment script..."
  $SCP_CMD "${SKYLARK_ROOT}/remote-deploy.sh" "${REMOTE_USER}@${REMOTE_IP}:${PARENT_DIR}/deploy-skylark.sh"

  echo "Running deployment script on remote server..."
  $SSH_CMD "${REMOTE_USER}@${REMOTE_IP}" "cd \"${PARENT_DIR}\" && chmod +x ./deploy-skylark.sh && ./deploy-skylark.sh \"${REMOTE_PATH}\""

  rm "${SKYLARK_ROOT}/remote-deploy.sh"

  echo -e "${GREEN}Remote deployment completed successfully!${NC}\n"
fi
