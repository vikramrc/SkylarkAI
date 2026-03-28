import { MongoClient, ObjectId } from "mongodb";

const uri = "mongodb://phoenix_read_only:securePassword123@localhost:27017/ProductsDB?authSource=ProductsDB";
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    const db = client.db("ProductsDB");

    console.log("--- Collection Check ---");
    const collections = await db.listCollections().toArray();
    console.log("Collections:", collections.map(c => c.name));

    const targetIDStr = "6985dd5b06473cba19765b34";
    const targetID = new ObjectId(targetIDStr);

    console.log("\n--- Identifying Entity for " + targetIDStr + " ---");
    // Check Budget collection first
    const budgetDoc = await db.collection("Budget").findOne({ _id: targetID });
    if (budgetDoc) {
      console.log("ID belongs to BUDGET document:");
      console.log(JSON.stringify(budgetDoc, null, 2));
    } else {
      console.log("ID NOT found in Budget collection.");
    }

    console.log("\n--- Searching for Cost Center 'TESTCOSTCENTER1' ---");
    const costCenterDoc = await db.collection("CostCenter").findOne({ name: "TESTCOSTCENTER1" });
    if (costCenterDoc) {
      console.log("Found Cost Center document:");
      console.log(JSON.stringify(costCenterDoc, null, 2));
      
      const transactions = await db.collection("BudgetTransaction").find({ costCenterID: costCenterDoc._id }).limit(5).toArray();
      console.log("\nTransactions for actual Cost Center ID (" + costCenterDoc._id + "):", transactions.length);
      if (transactions.length > 0) {
        console.log("Sample Transaction:");
        console.log(JSON.stringify(transactions[0], null, 2));
      }
    } else {
      console.log("Cost Center 'TESTCOSTCENTER1' NOT found.");
    }

    console.log("\n--- Searching Transactions for ID " + targetIDStr + " ---");
    const txCount = await db.collection("BudgetTransaction").countDocuments({ costCenterID: targetID });
    console.log("Transactions where costCenterID is " + targetIDStr + ":", txCount);
    
    const budgetTxCount = await db.collection("BudgetTransaction").countDocuments({ budgetID: targetID });
    console.log("Transactions where budgetID is " + targetIDStr + ":", budgetTxCount);

  } finally {
    await client.close();
  }
}

run().catch(console.error);
