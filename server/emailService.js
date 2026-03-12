const nodemailer = require('nodemailer');
const {
  analyzeInventory,
  analyzeFromData,
  buildOrderEmailBody,
  buildOrderEmailSubject,
} = require('./inventoryService');

const SENDER_EMAIL = process.env.GMAIL_USER || 'chonf.yjji@gmail.com';

/**
 * Nodemailer 트랜스포터 생성
 * Gmail: .env에 GMAIL_APP_PASSWORD 설정 필요
 */
function createTransporter() {
  const appPassword = process.env.GMAIL_APP_PASSWORD;
  if (!appPassword) {
    console.warn('GMAIL_APP_PASSWORD가 설정되지 않았습니다. 이메일 발송을 건너뜁니다.');
    return null;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: SENDER_EMAIL,
      pass: appPassword,
    },
  });
}

/**
 * 현재 데이터로 분석 결과 조회 (data: {suppliers, inventory} 또는 filePath)
 */
function getAnalysis(dataOrPath) {
  if (dataOrPath && typeof dataOrPath === 'object') {
    return analyzeFromData(dataOrPath.suppliers || [], dataOrPath.inventory || []);
  }
  return analyzeInventory(dataOrPath);
}

/**
 * 발주 이메일 발송 (단일 거래처)
 */
async function sendOrderEmail(supplierOrder, transporter = null, dataOrPath = null) {
  const trans = transporter || createTransporter();
  if (!trans) {
    return { success: false, message: '이메일 설정이 필요합니다. GMAIL_APP_PASSWORD를 설정하세요.' };
  }

  const { emailTemplate } = getAnalysis(dataOrPath);
  const subject = buildOrderEmailSubject(emailTemplate.subject, supplierOrder);
  const body = buildOrderEmailBody(emailTemplate.body, supplierOrder);

  const toEmail = supplierOrder.email || SENDER_EMAIL; // 수신자: 거래처 이메일 (없으면 본인)

  try {
    await trans.sendMail({
      from: SENDER_EMAIL,
      to: toEmail,
      subject,
      text: body,
    });
    return { success: true, to: toEmail, subject };
  } catch (err) {
    console.error('이메일 발송 실패:', err);
    return { success: false, message: err.message };
  }
}

/**
 * 모든 발주 필요 거래처에게 이메일 발송
 */
async function sendAllOrderEmails(dataOrPath = null) {
  const { ordersBySupplier } = getAnalysis(dataOrPath);
  const trans = createTransporter();

  if (!trans) {
    return {
      success: false,
      sent: 0,
      total: ordersBySupplier.length,
      results: [],
      message: 'GMAIL_APP_PASSWORD를 설정해주세요.',
    };
  }

  const results = [];
  for (const order of ordersBySupplier) {
    const result = await sendOrderEmail(order, trans, dataOrPath);
    results.push({
      supplier: order.supplier,
      to: order.email,
      ...result,
    });
  }

  const sent = results.filter(r => r.success).length;
  return {
    success: sent > 0,
    sent,
    total: ordersBySupplier.length,
    results,
  };
}

module.exports = {
  createTransporter,
  sendOrderEmail,
  sendAllOrderEmails,
  SENDER_EMAIL,
};
