import { MongoClient, ObjectId } from 'mongodb';

async function main() {
    const client = new MongoClient('mongodb://localhost:27017/ProductsDB');
    await client.connect();
    const db = client.db('ProductsDB');

    const KM_VESSEL_ID = '67eede7bc1ceddb21d80ad60';
    const XXX1_VESSEL_ID = '683b0257145b8a79367f829a';

    // The three CCCCCCC candidate IDs from dev.log (from resolve_labels turn)
    const candidateIds = [
        '68385e580aa5d05cc5c872d9', // ccccccccccccc — 1st match
        '6838b2bb11b79bf794c6384b', // ccccccc       — 2nd match
        '689301b219c14239e103660a', // ccccccc       — 3rd match
    ];

    console.log('\n=== CCCCCCC Candidates: Actual vesselID in DB ===');
    for (const id of candidateIds) {
        try {
            const doc = await db.collection('machineries').findOne(
                { _id: new ObjectId(id) },
                { projection: { machineryName: 1, vesselID: 1 } }
            );
            if (doc) {
                const vessel = doc.vesselID === KM_VESSEL_ID ? 'KOBAYASHI MARU' :
                               doc.vesselID === XXX1_VESSEL_ID ? 'XXX1' : doc.vesselID;
                console.log(`  ID: ${id} | Name: ${doc.machineryName} | vesselID: ${doc.vesselID} → ${vessel}`);
            } else {
                console.log(`  ID: ${id} → NOT FOUND in machineries collection`);
            }
        } catch (e) {
            console.log(`  ID: ${id} → Error: ${e}`);
        }
    }

    console.log('\n=== All CCCCCCC-named machineries (regex, all vessels) ===');
    const allCCC = await db.collection('machineries').find(
        { machineryName: { $regex: /CCCCCCC/i } },
        { projection: { machineryName: 1, vesselID: 1 } }
    ).toArray();
    for (const m of allCCC) {
        const vessel = m.vesselID === KM_VESSEL_ID ? 'KOBAYASHI MARU' :
                       m.vesselID === XXX1_VESSEL_ID ? 'XXX1' : m.vesselID;
        console.log(`  ID: ${m._id} | Name: ${m.machineryName} | vesselID: ${m.vesselID} → ${vessel}`);
    }

    console.log('\n=== Machineries registered on KM (Kobayashi Maru) ===');
    const kmMachineries = await db.collection('machineries').find(
        { vesselID: KM_VESSEL_ID },
        { projection: { machineryName: 1, vesselID: 1 } }
    ).toArray();
    console.log(`Total machineries on KM: ${kmMachineries.length}`);
    kmMachineries.slice(0, 20).forEach(m => console.log(`  ${m._id}: ${m.machineryName}`));

    console.log('\n=== Machineries registered on XXX1 ===');
    const xxx1Machineries = await db.collection('machineries').find(
        { vesselID: XXX1_VESSEL_ID },
        { projection: { machineryName: 1, vesselID: 1 } }
    ).toArray();
    console.log(`Total machineries on XXX1: ${xxx1Machineries.length}`);
    xxx1Machineries.slice(0, 20).forEach(m => console.log(`  ${m._id}: ${m.machineryName}`));

    await client.close();
}

main().catch(console.error);
