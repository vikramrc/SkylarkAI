#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Azure VM Configuration
AZURE_IP="20.169.48.27"
AZURE_KEY="/home/phantom/Downloads/seikaizen_key.pem"
AZURE_USER="azureuser"
AZURE_PATH="/home/azureuser/maximapmx/skylark"

echo -e "${GREEN}=== SkylarkAI One-Click Azure VM Deployment ===${NC}"
echo ""
echo -e "Deploying SkylarkAI to Azure VM with the following configuration:"
echo -e "  ${YELLOW}IP Address:${NC} $AZURE_IP"
echo -e "  ${YELLOW}SSH Key:${NC} $AZURE_KEY"
echo -e "  ${YELLOW}User:${NC} $AZURE_USER"
echo -e "  ${YELLOW}Path:${NC} $AZURE_PATH"
echo ""
echo -e "${YELLOW}Note:${NC} SkylarkAI will run on port 4000"
echo ""

# Confirm deployment
read -p "Continue with deployment? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}Deployment cancelled.${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}Starting deployment...${NC}"
echo ""

# Make sure deploy-all is executable
chmod +x ./deploy-all.sh

# Run the deploy-all script with parameters
./deploy-all.sh \
  --deploy-to-remote \
  --remote-ip="$AZURE_IP" \
  --remote-key="$AZURE_KEY" \
  --remote-user="$AZURE_USER" \
  --remote-path="$AZURE_PATH"

# Check if deployment was successful
if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}=== Deployment Completed Successfully! ===${NC}"
    echo ""
    echo -e "${YELLOW}=== NGINX CONFIGURATION BACKUP INSTRUCTIONS ===${NC}"
    echo -e "Since you are retiring phoenixai and replacing it with SkylarkAI:"
    echo ""
    echo -e "1. SSH into the Azure server:"
    echo -e "   ${YELLOW}ssh -i $AZURE_KEY $AZURE_USER@$AZURE_IP${NC}"
    echo ""
    echo -e "2. Edit the nginx configuration file:"
    echo -e "   ${YELLOW}sudo nano /etc/nginx/conf.d/default.conf${NC}"
    echo ""
    echo -e "3. **MODIFY** the existing \`/phoenixai/\` location block to point to **Port 4000**:"
    echo ""
    echo -e "${GREEN}    location /phoenixai/ {"
    echo -e "        proxy_pass http://localhost:4000/;"
    echo -e "        proxy_http_version 1.1;"
    echo -e "        proxy_set_header Upgrade \$http_upgrade;"
    echo -e "        proxy_set_header Connection 'upgrade';"
    echo -e "        proxy_set_header Host \$host;"
    echo -e "        proxy_cache_bypass \$http_upgrade;"
    echo -e "    }${NC}"
    echo ""
    echo -e "4. Test nginx configuration:"
    echo -e "   ${YELLOW}sudo nginx -t${NC}"
    echo ""
    echo -e "5. Reload nginx:"
    echo -e "   ${YELLOW}sudo nginx -s reload${NC}"
    echo ""
    echo -e "SkylarkAI is now taking over the /phoenixai/ URL seamlessly with its UI and API bundle!"
    echo ""
else
    echo ""
    echo -e "${RED}=== Deployment Failed ===${NC}"
fi
