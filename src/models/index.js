const AdminModel = require('./adminModel');
const ClientModel = require('./clientModel');
const UserModel = require('./userModel');
const PackModel = require('./packModel');
const VilleModel = require('./villeModel');
const CommuneModel = require('./communeModel');
const PromotionModel = require('./promotionModel');
const GameModel = require('./gameModel');
const MessageModel = require('./messageModel');
const NotificationModel = require('./notificationModel');
const SettingsModel = require('./settingsModel');
const WalletModel = require('./walletModel');
const ContentModel = require('./contentModel');
const ActivityModel = require('./activityModel');
const createDatabaseAuth = require('../config/createDb'); // <--- IMPORT

const initDatabase = async () => {
    console.log('🔄 Initializing Database Models...');
    try {
        // 0. CREATE DATABASE IF NOT EXISTS
        await createDatabaseAuth(); // <--- EXECUTE FIRST

        // 1. Independent Tables
        await AdminModel.createTable();
        await ClientModel.createTable();
        await UserModel.createTable();
        await PackModel.createTable();
        await VilleModel.createTable();
        await SettingsModel.createTable();

        // 2. Dependent Tables (Level 1)
        await CommuneModel.createTable(); // Depends on Ville
        await ContentModel.createTables(); // Includes feedback, etc.
        await WalletModel.createTables(); // Includes transactions, etc.

        // 3. More Dependent Tables
        await PromotionModel.createTable(); // Depends on Clients, Packs

        // 4. Yet More Dependencies
        await GameModel.createTable(); // Depends on Promotion
        await MessageModel.createTable(); // Depends on Users/Clients

        // 5. Final Dependencies
        await NotificationModel.createTable(); // Depends on Users
        await ActivityModel.createTables(); // Depends on Users, Games, Promotions

        console.log('✨ All Models Initialized Successfully.');
    } catch (error) {
        console.error('❌ Model Initialization Error:', error);
    }
};

module.exports = {
    initDatabase,
    AdminModel,
    ClientModel,
    UserModel,
    PackModel,
    VilleModel,
    CommuneModel,
    PromotionModel,
    GameModel,
    MessageModel,
    NotificationModel,
    SettingsModel,
    WalletModel,
    ContentModel,
    ActivityModel
};
