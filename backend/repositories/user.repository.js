const User = require("../models/User");

class UserRepository {
  async findById(userId) {
    return User.findById(userId);
  }

  async findByEmail(email) {
    return User.findOne({ email });
  }

  async findAll() {
    return User.find({}).select({ password: 0 });
  }

  async create(data) {
    return User.create(data);
  }
}

module.exports = new UserRepository();
