require('dotenv').config();
const mongoose = require('mongoose');
const RolePermissions = require('./src/models/RolePermissions');

async function updatePermissions() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected.');

        const role = 'sales_manager';
        console.log(`Checking permissions for role: ${role}`);

        const permissions = await RolePermissions.findOne({ role });

        if (!permissions) {
            console.error(`Role ${role} not found in DB!`);
            // Try to create it if it doesn't exist (though it should)
            const defaultPerms = RolePermissions.getDefaultPermissions(role);
            if (defaultPerms) {
                console.log('Creating role from defaults...');
                await RolePermissions.create({
                    role,
                    ...defaultPerms
                });
                console.log('Role created.');
            }
        } else {
            console.log('Current Bot Visibility:', permissions.visibility.bot);

            if (permissions.visibility.bot !== true) {
                console.log('Updating bot visibility to TRUE...');
                permissions.visibility.bot = true;
                // Ensure other permissions are preserved but visibility is updated

                // Mongoose might not detect deep change if we don't mark modified or use set
                // But simple assignment and save usually works.
                // Let's use updateOne to be sure.
                await RolePermissions.updateOne(
                    { role: role },
                    { $set: { "visibility.bot": true } }
                );

                console.log('Update command sent.');

                const verify = await RolePermissions.findOne({ role });
                console.log('Verification Bot Visibility:', verify.visibility.bot);
            } else {
                console.log('Bot visibility is already TRUE.');
            }
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected.');
    }
}

updatePermissions();
