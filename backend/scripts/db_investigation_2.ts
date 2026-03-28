import { MongoClient, ObjectId } from "mongodb";

const uri = "mongodb://phoenix_read_only:securePassword123@localhost:27017/ProductsDB?authSource=ProductsDB";
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    const db = client.db("ProductsDB");

    console.log("--- Comprehensive Cost Center Search ---");
    const costCenters = await db.collection("CostCenter").find({}).toArray();
    console.log("Total Cost Centers in DB:", costCenters.length);
    
    const matches = costCenters.filter(c => 
      (c.name && c.name.toString().includes("TESTCOSTCENTER")) || 
      (c.code && c.code.toString().includes("TESTCOSTCENTER")) ||
      (c.displayName && c.displayName.toString().includes("TESTCOSTCENTER"))
    );
    
    console.log("Matches for 'TESTCOSTCENTER':", JSON.stringify(matches, null, 2));

    if (matches.length > 0 && matches[0]) {
      const realCcId = matches[0]._id;
      const txCount = await db.collection("BudgetTransaction").countDocuments({ costCenterID: realCcId });
      console.log("\nTransactions for first match (" + matches[0].name + " / " + realCcId + "):", txCount);
      
      const sampleTx = await db.collection("BudgetTransaction").findOne({ costCenterID: realCcId });
      if (sampleTx) {
          console.log("Sample Transaction for Correct ID:");
          console.log(JSON.stringify(sampleTx, null, 2));
      }
    }

    console.log("\n--- Checking Budget Linkage ---");
    const budgetId = new ObjectId("6985dd5b06473cba19765b34");
    const budgetDoc = await db.collection("Budget").findOne({ _id: budgetId });
    if (budgetDoc && budgetDoc.costCenterID) {
        console.log("Budget " + budgetId + " links to costCenterID: " + budgetDoc.costCenterID);
        const linkedCc = await db.collection("CostCenter").findOne({ _id: budgetDoc.costCenterID });
        console.log("Linked Cost Center Document:", JSON.stringify(linkedCc, null, 2));
        
        const txsForLinkedCc = await db.collection("BudgetTransaction").countDocuments({ costCenterID: budgetDoc.costCenterID });
        console.log("Transactions for THIS linked costCenterID:", txsForLinkedCc);
    }

  } finally {
    await client.close();
  }
}

run().catch(console.error);
