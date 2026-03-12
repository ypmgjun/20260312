const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const DATA_PATH = path.resolve(__dirname, '..', 'sampleData', 'domino_inventory_training.xlsx');
const STORE_NAME = '도미노피자 강남점';

const DEFAULT_EMAIL_TEMPLATE = {
  subject: '[발주요청] {{STORE_NAME}} / {{SUPPLIER_NAME}} / {{ORDER_DATE}}',
  body: `안녕하세요 {{SUPPLIER_NAME}} 담당자님.

도미노피자 {{STORE_NAME}}입니다.
아래 품목에 대해 발주 요청드립니다.

{{ITEM_LIST}}

첨부한 발주서 확인 부탁드립니다.
감사합니다.
{{INTERNAL_OWNER}}`,
};

/**
 * Excel 파일에서 시트 데이터 읽기
 */
function loadWorkbook(filePath = DATA_PATH) {
  let targetPath = filePath;
  if (!fs.existsSync(targetPath)) {
    const altPath = path.join(process.cwd(), 'sampleData', 'domino_inventory_training.xlsx');
    if (fs.existsSync(altPath)) {
      targetPath = altPath;
    } else {
      throw new Error(`파일을 찾을 수 없습니다. 경로: ${filePath}`);
    }
  }
  return XLSX.readFile(targetPath);
}

/**
 * Suppliers 시트 파싱
 */
function getSuppliers(wb) {
  const ws = wb.Sheets['Suppliers'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const [headers, ...data] = rows;
  return data
    .filter(row => row && row[0])
    .map(row => ({
      name: row[0],
      contact: row[1],
      email: row[2],
      leadTime: row[3] || 0,
      itemGroup: row[4] || '',
    }));
}

/**
 * Inventory 시트 파싱 및 재고 분석
 * 재고 부족 기준: 현재재고 < 안전재고
 * 발주 권장 수량: MAX(MOQ, 안전재고 - 현재재고)
 */
function getInventoryWithAnalysis(wb) {
  const ws = wb.Sheets['Inventory'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const [headers, ...data] = rows;

  const colIndex = (name) => headers.findIndex(h => (h || '').includes(name));

  const idx = {
    code: colIndex('품목코드'),
    name: colIndex('재료명'),
    spec: colIndex('규격'),
    unit: colIndex('단위'),
    current: colIndex('현재재고'),
    safety: colIndex('안전재고'),
    moq: colIndex('MOQ'),
    supplier: colIndex('거래처'),
    contact: colIndex('알림담당자'),
    email: colIndex('거래처이메일'),
    leadTime: colIndex('리드타임'),
  };

  return data
    .filter(row => row && row[idx.code])
    .map(row => {
      const current = Number(row[idx.current]) || 0;
      const safety = Number(row[idx.safety]) || 0;
      const moq = Number(row[idx.moq]) || 1;
      const shortage = Math.max(0, safety - current);
      const orderQty = shortage > 0 ? Math.max(moq, shortage) : 0;
      const status = current < safety ? '발주 필요' : '정상';
      const alertMsg = status === '발주 필요'
        ? `${row[idx.name]} 재고 부족 - 현재 ${current}${row[idx.unit]}, 안전재고 ${safety}${row[idx.unit]}, 권장발주 ${orderQty}${row[idx.unit]}`
        : '';

      return {
        code: row[idx.code],
        name: row[idx.name],
        spec: row[idx.spec] || '',
        unit: row[idx.unit] || '',
        current,
        safety,
        moq,
        supplier: row[idx.supplier] || '',
        contact: row[idx.contact] || '',
        email: row[idx.email] || '',
        leadTime: row[idx.leadTime] || 0,
        shortage,
        orderQty,
        status,
        alertMessage: alertMsg,
      };
    });
}

/**
 * 거래처별 발주 목록 그룹화
 */
function getOrdersBySupplier(inventory) {
  const needOrder = inventory.filter(i => i.status === '발주 필요');
  const bySupplier = {};

  needOrder.forEach(item => {
    const key = item.supplier;
    if (!bySupplier[key]) {
      bySupplier[key] = {
        supplier: key,
        items: [],
        totalQty: 0,
        contact: item.contact,
        email: item.email,
      };
    }
    bySupplier[key].items.push(item);
    bySupplier[key].totalQty += item.orderQty;
  });

  return Object.values(bySupplier);
}

/**
 * EmailTemplate 시트에서 템플릿 읽기
 */
function getEmailTemplate(wb) {
  const ws = wb.Sheets['EmailTemplate'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  let subject = '';
  let body = '';
  rows.forEach(row => {
    const str = (row[0] || '').toString();
    if (str.includes('제목')) subject = (row[1] || '').toString();
    if (str.includes('본문')) body = (row[1] || '').toString();
  });
  return { subject, body };
}

/**
 * JSON 데이터로 재고 분석 (입력값 기반)
 */
function analyzeFromData(suppliers = [], inventoryRaw = []) {
  const inventory = inventoryRaw.map(row => {
    const current = Number(row.current) || 0;
    const safety = Number(row.safety) || 0;
    const moq = Number(row.moq) || 1;
    const shortage = Math.max(0, safety - current);
    const orderQty = shortage > 0 ? Math.max(moq, shortage) : 0;
    const status = current < safety ? '발주 필요' : '정상';
    const unit = row.unit || '';
    const alertMsg = status === '발주 필요'
      ? `${row.name} 재고 부족 - 현재 ${current}${unit}, 안전재고 ${safety}${unit}, 권장발주 ${orderQty}${unit}`
      : '';

    return {
      code: row.code || '',
      name: row.name || '',
      spec: row.spec || '',
      unit,
      current,
      safety,
      moq,
      supplier: row.supplier || '',
      contact: row.contact || '',
      email: row.email || '',
      leadTime: Number(row.leadTime) || 0,
      shortage,
      orderQty,
      status,
      alertMessage: alertMsg,
    };
  });

  // 거래처 이메일 매핑 (재고 항목에 거래처 이메일이 없으면 보완)
  const supplierMap = {};
  suppliers.forEach(s => { supplierMap[s.name] = s; });
  inventory.forEach(i => {
    if (!i.email && supplierMap[i.supplier]) {
      i.email = supplierMap[i.supplier].email;
    }
  });

  const ordersBySupplier = getOrdersBySupplier(inventory);
  const needOrderCount = inventory.filter(i => i.status === '발주 필요').length;
  const totalOrderQty = ordersBySupplier.reduce((s, o) => s + o.totalQty, 0);

  return {
    storeName: STORE_NAME,
    suppliers,
    inventory,
    ordersBySupplier,
    summary: {
      totalItems: inventory.length,
      needOrderCount,
      totalOrderQty,
      status: needOrderCount > 0 ? '담당자 확인 필요' : '정상',
    },
    emailTemplate: DEFAULT_EMAIL_TEMPLATE,
  };
}

/**
 * 전체 분석 결과 반환 (Excel 파일 또는 저장된 데이터)
 */
function analyzeInventory(filePathOrData = null) {
  // JSON 데이터 직접 전달
  if (filePathOrData && typeof filePathOrData === 'object' && !Array.isArray(filePathOrData)) {
    return analyzeFromData(filePathOrData.suppliers || [], filePathOrData.inventory || []);
  }

  const wb = loadWorkbook(filePathOrData || DATA_PATH);
  const suppliers = getSuppliers(wb);
  const inventory = getInventoryWithAnalysis(wb);
  const ordersBySupplier = getOrdersBySupplier(inventory);
  const { subject, body } = getEmailTemplate(wb);

  const needOrderCount = inventory.filter(i => i.status === '발주 필요').length;
  const totalOrderQty = ordersBySupplier.reduce((s, o) => s + o.totalQty, 0);

  return {
    storeName: STORE_NAME,
    suppliers,
    inventory,
    ordersBySupplier,
    summary: {
      totalItems: inventory.length,
      needOrderCount,
      totalOrderQty,
      status: needOrderCount > 0 ? '담당자 확인 필요' : '정상',
    },
    emailTemplate: { subject, body },
  };
}

/**
 * Excel에서 샘플 데이터 추출 (웹 입력용)
 */
function getSampleDataForForm() {
  const wb = loadWorkbook();
  if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) {
    throw new Error('엑셀 파일을 읽을 수 없거나 시트가 비어 있습니다.');
  }

  // Suppliers 시트
  const supplierSheet = wb.Sheets['Suppliers'] || wb.Sheets[wb.SheetNames[1]];
  if (!supplierSheet) {
    throw new Error('Suppliers 시트를 찾을 수 없습니다.');
  }
  const suppliers = getSuppliers(wb);

  // Inventory 시트
  const invSheetName = wb.SheetNames.find(n => n === 'Inventory' || n.includes('재고') || n.includes('Inventory'));
  const ws = wb.Sheets[invSheetName || 'Inventory'] || wb.Sheets[wb.SheetNames[2]];
  if (!ws) {
    throw new Error('Inventory 시트를 찾을 수 없습니다.');
  }

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows || rows.length < 2) {
    throw new Error('Inventory 시트에 데이터가 없습니다.');
  }

  const headers = rows[0] || [];
  const data = rows.slice(1);

  const colIndex = (name) => {
    const i = headers.findIndex(h => String(h || '').includes(name));
    return i >= 0 ? i : -1;
  };
  const ci = (name, fallback) => {
    const i = colIndex(name);
    return i >= 0 ? i : fallback;
  };

  const idx = {
    code: ci('품목코드', 0),
    name: ci('재료명', 1),
    spec: ci('규격', 2),
    unit: ci('단위', 3),
    current: ci('현재재고', 4),
    safety: ci('안전재고', 5),
    moq: ci('MOQ', 6),
    supplier: ci('거래처', 7),
    contact: ci('알림담당자', 8),
    email: colIndex('거래처이메일') >= 0 ? colIndex('거래처이메일') : ci('이메일', 9),
    leadTime: ci('리드타임', 10),
  };

  const inventory = data
    .filter(row => row && (row[idx.code] != null && row[idx.code] !== '') || (row[idx.name] != null && row[idx.name] !== ''))
    .map(row => ({
      code: row[idx.code] != null ? String(row[idx.code]).trim() : '',
      name: row[idx.name] != null ? String(row[idx.name]).trim() : '',
      spec: row[idx.spec] != null ? String(row[idx.spec]).trim() : '',
      unit: row[idx.unit] != null ? String(row[idx.unit]).trim() : '',
      current: Number(row[idx.current]) || 0,
      safety: Number(row[idx.safety]) || 0,
      moq: Number(row[idx.moq]) || 1,
      supplier: row[idx.supplier] != null ? String(row[idx.supplier]).trim() : '',
      contact: row[idx.contact] != null ? String(row[idx.contact]).trim() : '',
      email: row[idx.email] != null ? String(row[idx.email]).trim() : '',
      leadTime: Number(row[idx.leadTime]) || 0,
    }));

  return { suppliers, inventory };
}

/**
 * 발주 이메일 본문 생성
 */
function buildOrderEmailBody(template, supplierOrder, storeName = STORE_NAME) {
  const orderDate = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const itemList = supplierOrder.items
    .map(i => `- ${i.name} (${i.spec}): ${i.orderQty}${i.unit}`)
    .join('\n');

  return template
    .replace(/\{\{STORE_NAME\}\}/g, storeName)
    .replace(/\{\{SUPPLIER_NAME\}\}/g, supplierOrder.supplier)
    .replace(/\{\{ORDER_DATE\}\}/g, orderDate)
    .replace(/\{\{ITEM_LIST\}\}/g, itemList)
    .replace(/\{\{INTERNAL_OWNER\}\}/g, '도미노피자 재고관리팀');
}

function buildOrderEmailSubject(template, supplierOrder, storeName = STORE_NAME) {
  const orderDate = new Date().toLocaleDateString('ko-KR').replace(/\. /g, '-').replace('.', '');
  return template
    .replace(/\{\{STORE_NAME\}\}/g, storeName)
    .replace(/\{\{SUPPLIER_NAME\}\}/g, supplierOrder.supplier)
    .replace(/\{\{ORDER_DATE\}\}/g, orderDate);
}

module.exports = {
  loadWorkbook,
  getSuppliers,
  getInventoryWithAnalysis,
  getOrdersBySupplier,
  getEmailTemplate,
  analyzeInventory,
  analyzeFromData,
  getSampleDataForForm,
  buildOrderEmailBody,
  buildOrderEmailSubject,
  STORE_NAME,
};
