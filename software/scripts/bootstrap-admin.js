/**
 * TAMTAP Bootstrap Admin Script
 * Creates the initial admin account for the system
 * 
 * Usage: npm run bootstrap
 *        node scripts/bootstrap-admin.js
 * 
 * Contract: Admin accounts are created manually (bootstrap)
 */

const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const readline = require('readline');

// Load config
require('dotenv').config({ path: '../.env' });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/';
const MONGODB_NAME = process.env.MONGODB_NAME || 'tamtap';

// Default admin credentials (change these!)
const DEFAULT_ADMIN = {
    username: 'admin',
    password: 'tamtap2026',
    name: 'System Administrator'
};

async function createAdmin(username, password, name) {
    let client = null;
    
    try {
        console.log('\n========================================');
        console.log('  TAMTAP Admin Bootstrap');
        console.log('========================================\n');
        
        // Connect to MongoDB
        console.log('Connecting to MongoDB...');
        client = new MongoClient(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000
        });
        await client.connect();
        
        const db = client.db(MONGODB_NAME);
        console.log(`Connected to database: ${MONGODB_NAME}\n`);
        
        // Check if admin exists
        const existingAdmin = await db.collection('admins').findOne({ 
            username: username.toLowerCase() 
        });
        
        if (existingAdmin) {
            console.log(`[WARN] Admin user "${username}" already exists.`);
            console.log('Do you want to reset the password? (Requires manual DB update)\n');
            return false;
        }
        
        // Hash password
        console.log('Creating admin account...');
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Insert admin
        await db.collection('admins').insertOne({
            username: username.toLowerCase(),
            password: hashedPassword,
            name: name,
            role: 'admin',
            created: new Date().toISOString()
        });
        
        console.log('\n========================================');
        console.log('  ✅ Admin account created successfully!');
        console.log('========================================');
        console.log(`  Username: ${username}`);
        console.log(`  Password: ${password}`);
        console.log(`  Name: ${name}`);
        console.log('========================================\n');
        console.log('[!] IMPORTANT: Change the default password after first login!\n');
        
        return true;
        
    } catch (error) {
        console.error('\n[ERROR] Bootstrap failed:', error.message);
        return false;
    } finally {
        if (client) {
            await client.close();
            console.log('MongoDB connection closed.');
        }
    }
}

// Interactive mode
async function interactiveMode() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    const question = (prompt) => new Promise(resolve => rl.question(prompt, resolve));
    
    console.log('\n========================================');
    console.log('  TAMTAP Admin Bootstrap (Interactive)');
    console.log('========================================\n');
    
    const useDefault = await question('Use default credentials? (y/n): ');
    
    let username, password, name;
    
    if (useDefault.toLowerCase() === 'y') {
        username = DEFAULT_ADMIN.username;
        password = DEFAULT_ADMIN.password;
        name = DEFAULT_ADMIN.name;
    } else {
        username = await question('Admin username: ');
        password = await question('Admin password (min 6 chars): ');
        name = await question('Admin full name: ');
        
        if (!username || !password || password.length < 6) {
            console.log('\n[ERROR] Invalid input. Username and password (6+ chars) required.\n');
            rl.close();
            return;
        }
    }
    
    rl.close();
    await createAdmin(username, password, name);
}

// Check if running with arguments
const args = process.argv.slice(2);

if (args.includes('--default')) {
    // Use default credentials
    createAdmin(DEFAULT_ADMIN.username, DEFAULT_ADMIN.password, DEFAULT_ADMIN.name);
} else if (args.length >= 2) {
    // Use command line arguments: node bootstrap-admin.js username password [name]
    const [username, password, name = 'Administrator'] = args;
    createAdmin(username, password, name);
} else {
    // Interactive mode
    interactiveMode();
}
