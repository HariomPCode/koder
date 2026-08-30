const { Question } = require("@koder/shared");

class QuestionRepository {
  async findById(questionId) {
    return Question.findById(questionId);
  }

  async findOneBySlug(slug) {
    return Question.findOne({ slug }).select({ hiddenTestCases: 0 });
  }

  async findAll({ page = 1, limit = 20, skip = 0 } = {}) {
    return Question.find({})
      .select({
        questionNum: 1,
        title: 1,
        slug: 1,
        difficulty: 1,
        tags: 1,
      })
      .sort({ questionNum: 1 })
      .skip(skip)
      .limit(limit);
  }

  async findAllForStats() {
    return Question.find({}).select("title slug difficulty").lean();
  }

  async create(data) {
    return Question.create(data);
  }

  async updateById(questionId, data) {
    return Question.findByIdAndUpdate(questionId, data, {
      new: true,
      runValidators: true,
    });
  }

  async deleteById(questionId) {
    return Question.findByIdAndDelete(questionId);
  }

  async findLatestQuestionNum() {
    return Question.findOne().sort({ questionNum: -1 });
  }
}

module.exports = new QuestionRepository();
