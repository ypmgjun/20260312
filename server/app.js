require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const { analyzeInventory, analyzeFromData, getSampleDataForForm } = require('./inventoryService');
const { sendOrderEmail, sendAllOrderEmails } = require('./emailService');

const app = express();
const COOKIE_NAME = 'inv_auth';
const COOKIE_MAX_AGE = 24 * 60 * 60 * 1000; // 24시간

function getAuthToken() {
  const secret = process.env.TEAM_PASSWORD || 'default';
  const ts = Math.floor(Date.now() / COOKIE_MAX_AGE).toString();
  return crypto.createHmac('sha256', secret).update(ts).digest('hex');
}

function verifyAuth(req) {
  const token = req.cookies?.[COOKIE_NAME] || req.headers?.['x-auth-token'];
  const expected = getAuthToken();
  if (!token || token.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function authMiddleware(req, res, next) {
  if (!process.env.TEAM_PASSWORD) return next();
  if (req.path === '/' || req.path === '/index.html' || req.path === '/api/auth' || req.path === '/api/auth/check') return next();
  if (!req.path.startsWith('/api/')) return next(); // 정적 파일 등
  if (verifyAuth(req)) return next();
  res.status(401).json({ error: '인증이 필요합니다.', code: 'AUTH_REQUIRED' });
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use((req, res, next) => {
  if (req.headers.cookie) {
    req.cookies = Object.fromEntries(
      req.headers.cookie.split(';').map(s => {
        const [k, v] = s.trim().split('=');
        return [k, v?.replace(/^"|"$/g, '')];
      })
    );
  } else req.cookies = {};
  next();
});

app.use(authMiddleware);

// 루트 경로: HTML 서빙 (Vercel에서 정적 파일 미제공 시)
app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

let storedData = { suppliers: [], inventory: [] };

function getCurrentAnalysis(dataOverride = null) {
  const data = dataOverride || storedData;
  const hasData = data.suppliers?.length > 0 || data.inventory?.length > 0;
  if (hasData) {
    return analyzeFromData(data.suppliers || [], data.inventory || []);
  }
  return analyzeInventory();
}

app.post('/api/auth', (req, res) => {
  const inputPassword = String(req.body?.password ?? '').trim();
  const teamPassword = (process.env.TEAM_PASSWORD ?? '').trim();
  if (!teamPassword) {
    return res.json({ success: true });
  }
  if (inputPassword !== teamPassword) {
    return res.status(401).json({
      success: false,
      error: '비밀번호가 올바르지 않습니다. 팀 비밀번호를 확인해주세요.',
    });
  }
  const token = getAuthToken();
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE / 1000}; HttpOnly; SameSite=Lax`);
  res.json({ success: true });
});

app.get('/api/auth/check', (req, res) => {
  if (!process.env.TEAM_PASSWORD) {
    return res.json({ authenticated: true });
  }
  res.json({ authenticated: verifyAuth(req) });
});

app.get('/api/data', (req, res) => {
  res.json(storedData);
});

app.get('/api/sample', (req, res) => {
  try {
    const data = getSampleDataForForm();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/data', (req, res) => {
  try {
    const { suppliers = [], inventory = [] } = req.body;
    storedData = {
      suppliers: Array.isArray(suppliers) ? suppliers : [],
      inventory: Array.isArray(inventory) ? inventory : [],
    };
    const result = getCurrentAnalysis();
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/inventory', (req, res) => {
  try {
    const result = getCurrentAnalysis();
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/send-order/:supplierName', async (req, res) => {
  try {
    const bodyData = req.body || {};
    const dataOrPath = (bodyData.suppliers?.length || bodyData.inventory?.length) ? bodyData : storedData;
    const result = getCurrentAnalysis(dataOrPath);
    const order = result.ordersBySupplier.find(
      o => o.supplier === decodeURIComponent(req.params.supplierName)
    );
    if (!order) {
      return res.status(404).json({ error: '해당 거래처를 찾을 수 없습니다.' });
    }
    const sendResult = await sendOrderEmail(order, null, dataOrPath);
    res.json(sendResult);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/send-all-orders', async (req, res) => {
  try {
    const bodyData = req.body || {};
    const dataOrPath = (bodyData.suppliers?.length || bodyData.inventory?.length) ? bodyData : storedData;
    const result = await sendAllOrderEmails(dataOrPath);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
