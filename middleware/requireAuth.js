const jwt = require('jsonwebtoken');

// Checks the Authorization header, verifies the token,
// and attaches userId to req before the route handler runs
module.exports = function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: { code: 'unauthorized', message: '請先登入' } });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next(); // token is valid — continue to the actual route
  } catch (err) {
    return res.status(401).json({ error: { code: 'token_invalid', message: '登入已過期，請重新登入' } });
  }
};

// 「中介層（middleware）」= 站在路由前面的守衛：token 合法就放行並把 userId 交給後面的處理函式，不合法直接擋下。
// 之後所有需要登入的 API 都得掛它。