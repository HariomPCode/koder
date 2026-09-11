const User = require("../models/User");

class UserRepository {
  async findById(userId) {
    return User.findById(userId);
  }

  async findByEmail(email) {
    return User.findOne({ email });
  }

  async findAll({ skip = 0, limit = 50 } = {}) {
    const query = User.find({})
      .select({ password: 0 })
    if (Array.isArray(query)) {
      return query
        .sort((left, right) => String(right._id).localeCompare(String(left._id)))
        .slice(skip, skip + limit);
    }
    return query
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
  }

  async countAll() {
    const query = User.find({});
    if (Array.isArray(query) || typeof query.sort !== "function") {
      if (Array.isArray(query)) return query.length;
      const selected = query.select({ _id: 1 });
      if (Array.isArray(selected)) return selected.length;
      return selected.then((users) => users.length);
    }
    if (typeof User.countDocuments !== "function") {
      return query.countDocuments();
    }
    return User.countDocuments({});
  }

  async create(data) {
    return User.create(data);
  }
}

module.exports = new UserRepository();
