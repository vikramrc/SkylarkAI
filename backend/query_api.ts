import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env") });
import axios from "axios";

async function run() {
    try {
        const res = await axios.post("http://localhost:4000/api/phoenix/query/stream", {
            action: "budget.query_overview",
            params: {
              organizationShortName: "fleetships",
              searchTerm: "TESTCOSTCENTER1"
            }
        });
        console.log(JSON.stringify(res.data, null, 2));
    } catch(e: any) { console.log(e.response?.data || e.message); }
}
run();
