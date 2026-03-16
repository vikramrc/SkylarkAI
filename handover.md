# SkylarkAI - Authentication Handover Document

## 🔍 **The Problem: Tool Authentication Drops**
We encountered persistent `401 Unauthorized` (`Invalid token payload` or `No token provided`) and `404 Not Found` messages whenever the SkylarkAI Agent attempted to trigger an MCP tool Proxy call (e.g. `maintenance_query_status`) against the backend receiver `PhoenixCloudBE` (Port 3000 over HTTPS).

### **Root Cause: The Brittle Cookie-Relay Design**
The proxy architecture in **`backend/src/mcp/proxy.ts`** relies on transparently forwarding standard **Browser HttpOnly Cookies** (such as dynamic SSO configuration cookies like `orgData_ssorg`) down to inner Axios calls. 
* Stateful Cookie structures operate correctly inside same-origin dashboard forwards.
* But standard backend Axios calls fail because direct hits to the backend bypass transparent header translators setups built into other wrappers.
* Node router doesn't have access to isolate in-memory memory session maps allocated to parallel server branches.

---

## 🛠️ **Iterative Tests and Measures Added**

### **1. Robust extraction fallback**
* **File File**: `backend/src/mastra/routes/workflow.ts`
* **Fix added**: Modifed `authToken` extraction. While it prioritizes a standalone `token=` extraction via Regex, if it returns empty, it now **simply transparently relays the full `cookies` lists forwards** as the relay auth string so and Axios forwards safely simulates Origin headers backwards.

### **2. Cookie-Aware AXIOS Header assignments**
* **File File**: `backend/src/mcp/proxy.ts`
* **Fix added**: Standard triggers set `Authorization: Bearer <cookies>`. Added an evaluation block evaluating if `activeToken.includes('=')` (proving is a Raw cookie list) and mapping it safely to `headers['Cookie'] = activeToken` instead of Bearer string.

### **3. Transparent Auth Proxy Router (Translating Aliases)**
* **File File**: `backend/src/index.ts`
* **Problem**: Forwarding Login screens or checks hit aliases errors (like `/check` vs real core endpoint `/check-auth`).
* **Fix added**: Added a catch-all Express Router handler for `/api/auth/*` catching all frontend template hits, Translating `/check` into `/check-auth` and transparently relaying full headers securely to `https://localhost:3000`.

---

## 💡 **Technical Proposal & Recommendations for Next Agent**

### **The Architecture Pivot: Direct Static Authentication**
Using transparent stateful browser cookie relays inside direct backend Node AXIOS calls is highly complex and brittle. 

**Recommended Pivot Pattern**:
Configure Skylark to operate fully autonomously as a standard **Service-to-Service MCP Client**:
1. **Direct Access Tokens**: Provide standard access to append a direct Service Account static API Key / App Secret configuration loaded directly in `.env`.
2. **Authorization Header**: Skip reading cookie lists inside Node forwards completely. Configure `proxy.ts` to attach standard static static static header: `headers['Authorization'] = 'Bearer <STATIC_API_KEY>'`.

This completely eliminates isolation variables bounding between your direct Core login setup maps. 

---

## 📂 **References**
* [PhoenixCloudFE2 - Existing Handover](file:///home/phantom/testcodes/PhoenixCloudFE2/handover.md) - Contains baseline Dashboard setup notes.
