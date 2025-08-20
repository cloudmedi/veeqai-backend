const mongoose = require('mongoose');

async function migrateData() {
  try {
    // Connect to local MongoDB
    const localDB = mongoose.createConnection('mongodb://localhost:27017/veeqai');
    await localDB.asPromise();
    console.log('Connected to local MongoDB');
    
    // Connect to Railway MongoDB  
    const remoteDB = mongoose.createConnection('mongodb://mongo:nBCgxCFXthphjlkMmVjChyBLEHjPSfLO@interchange.proxy.rlwy.net:57752');
    await remoteDB.asPromise();
    console.log('Connected to Railway MongoDB');
    
    // Get all collections from local DB
    const collections = await localDB.db.listCollections().toArray();
    console.log(`Found ${collections.length} collections to migrate`);
    
    // Migrate each collection
    for (const collInfo of collections) {
      const collName = collInfo.name;
      console.log(`\nMigrating collection: ${collName}`);
      
      // Get all documents from local collection
      const localColl = localDB.db.collection(collName);
      const documents = await localColl.find({}).toArray();
      console.log(`  Found ${documents.length} documents`);
      
      if (documents.length > 0) {
        // Clear remote collection first
        const remoteColl = remoteDB.db.collection(collName);
        await remoteColl.deleteMany({});
        
        // Insert all documents to remote
        const result = await remoteColl.insertMany(documents);
        console.log(`  Inserted ${result.insertedCount} documents`);
      }
    }
    
    console.log('\n✅ Migration completed successfully!');
    
    // Close connections
    await localDB.close();
    await remoteDB.close();
    process.exit(0);
    
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrateData();