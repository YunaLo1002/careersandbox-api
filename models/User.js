const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    school: { type: String, default: '' },
    department: { type: String, default: '' },
    year: { type: String, default: '' },
    interests: { type: [String], default: [] },
    skillsHave: { type: [String], default: [] },
    skillsWant: { type: [String], default: [] },
  },
  { timestamps: true }
);
// 只有 name 和 email 是 required——學校系所這些給預設空值，使用者沒填也能註冊成功。

module.exports = mongoose.model('User', userSchema, 'users');