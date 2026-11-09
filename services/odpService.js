const db = require('../config/database');

/**
 * ODP SERVICE (Updated for Multi-Splitter & Port Management)
 */

function getAllOdps() {
  const odps = db.prepare(`
    SELECT o.*, olt.name as olt_name, parent.name as parent_odp_name 
    FROM odps o 
    LEFT JOIN olts olt ON o.olt_id = olt.id 
    LEFT JOIN odps parent ON o.parent_odp_id = parent.id
    ORDER BY o.name ASC
  `).all();

  for (const odp of odps) {
    // Ambil data splitter
    odp.splitters = db.prepare(`
      SELECT * FROM odp_box_splitters WHERE odp_id = ? ORDER BY id ASC
    `).all(odp.id);

    // Ambil data port beserta informasi tujuannya
    odp.ports = db.prepare(`
      SELECT p.*, 
             c.name as customer_name, 
             child.name as child_odp_name
      FROM odp_ports p
      LEFT JOIN customers c ON p.target_type = 'CUSTOMER' AND p.target_id = c.id
      LEFT JOIN odps child ON p.target_type = 'CHILD_ODP' AND p.target_id = child.id
      WHERE p.odp_id = ?
      ORDER BY p.splitter_id ASC, p.port_number ASC
    `).all(odp.id);
  }

  return odps;
}

function getOdpById(id) {
  const odp = db.prepare('SELECT * FROM odps WHERE id = ?').get(id);
  if (odp) {
    odp.splitters = db.prepare(`
      SELECT * FROM odp_box_splitters WHERE odp_id = ? ORDER BY id ASC
    `).all(id);

    odp.ports = db.prepare(`
      SELECT p.*, 
             c.name as customer_name, 
             child.name as child_odp_name
      FROM odp_ports p
      LEFT JOIN customers c ON p.target_type = 'CUSTOMER' AND p.target_id = c.id
      LEFT JOIN odps child ON p.target_type = 'CHILD_ODP' AND p.target_id = child.id
      WHERE p.odp_id = ?
      ORDER BY p.splitter_id ASC, p.port_number ASC
    `).all(id);
  }
  return odp;
}

// Helper untuk menentukan jumlah port berdasarkan rasio splitter
function getPortCountFromRatio(type, ratio) {
  if (type === 'PLC') {
    const match = ratio.match(/1:(\d+)/);
    if (match && match[1]) return parseInt(match[1], 10);
    return 8; // Default PLC
  } else if (type === 'FBT') {
    // FBT biasanya coupler 2 arah (Port 1 untuk cabang, Port 2 untuk trunk)
    return 2;
  }
  return 8;
}

function createOdp(data) {
  const updateOdpStmt = db.prepare(`
    UPDATE odps 
    SET name = ?, parent_odp_id = ?, splitter_type = ?, splitter_ratio = ?, input_power_dbm = ?, olt_id = ?, pon_port = ?, port_capacity = ?, lat = ?, lng = ?, description = ?
    WHERE id = ?
  `);

  const types = Array.isArray(data.splitter_types) ? data.splitter_types : [data.splitter_type || 'PLC'];
  const ratios = Array.isArray(data.splitter_ratios) ? data.splitter_ratios : [data.splitter_ratio || '1:8'];
  
  const primaryType = types[0] || 'PLC';
  const primaryRatio = ratios[0] || '1:8';

  const transaction = db.transaction((odpId, formData) => {
    // 1. Update data utama ODP
    updateOdpStmt.run(
      formData.name,
      formData.parent_odp_id ? parseInt(formData.parent_odp_id) : null,
      primaryType,
      primaryRatio,
      formData.input_power_dbm !== undefined && formData.input_power_dbm !== null && formData.input_power_dbm !== '' ? parseFloat(formData.input_power_dbm) : -9.0,
      formData.olt_id ? parseInt(formData.olt_id) : null,
      formData.pon_port || '',
      formData.port_capacity !== undefined && formData.port_capacity !== null ? parseInt(formData.port_capacity) : 16,
      formData.lat || '',
      formData.lng || '',
      formData.description || '',
      odpId
    );

    // 2. Hapus data splitter & port lama
    db.prepare('DELETE FROM odp_ports WHERE odp_id = ?').run(odpId);
    db.prepare('DELETE FROM odp_box_splitters WHERE odp_id = ?').run(odpId);

    const insertSplitter = db.prepare(`
      INSERT INTO odp_box_splitters (odp_id, splitter_index, splitter_type, splitter_ratio)
      VALUES (?, ?, ?, ?)
    `);

    const insertPort = db.prepare(`
      INSERT INTO odp_ports (odp_id, splitter_id, port_number, splitter_index, target_type, target_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    let targetIndex = 0;
    for (let i = 0; i < types.length; i++) {
      if (types[i]) {
        const sType = types[i];
        const sRatio = ratios[i] || '1:8';
        const splitterRes = insertSplitter.run(odpId, i + 1, sType, sRatio);
        const splitterId = splitterRes.lastInsertRowid;

        const portCount = getPortCountFromRatio(sType, sRatio);
        for (let p = 1; p <= portCount; p++) {
          let tType = 'EMPTY';
          let tId = null;

          if (formData.port_targets && formData.port_targets[targetIndex]) {
            const rawTarget = String(formData.port_targets[targetIndex]);
            if (rawTarget.startsWith('CUSTOMER_')) {
              tType = 'CUSTOMER';
              tId = parseInt(rawTarget.replace('CUSTOMER_', ''), 10);
            } else if (rawTarget.startsWith('CHILD_ODP_')) {
              tType = 'CHILD_ODP';
              tId = parseInt(rawTarget.replace('CHILD_ODP_', ''), 10);
              
              // OTOMATIS: Set parent_odp_id pada ODP tujuan jika port ini diarahkan ke ODP Anak!
              db.prepare('UPDATE odps SET parent_odp_id = ? WHERE id = ?').run(tId, odpId);
            }
          }

          insertPort.run(odpId, splitterId, p, i + 1, tType, tId);
          targetIndex++;
        }
      }
    }
  });

  return transaction(id, data);
}

function updateOdp(id, data) {
  const updateOdpStmt = db.prepare(`
    UPDATE odps 
    SET name = ?, parent_odp_id = ?, splitter_type = ?, splitter_ratio = ?, input_power_dbm = ?, olt_id = ?, pon_port = ?, port_capacity = ?, lat = ?, lng = ?, description = ?
    WHERE id = ?
  `);

  const types = Array.isArray(data.splitter_types) ? data.splitter_types : [data.splitter_type || 'PLC'];
  const ratios = Array.isArray(data.splitter_ratios) ? data.splitter_ratios : [data.splitter_ratio || '1:8'];
  
  // 👈 TANGKAP ARRAY PORT DARI FORM MODAL EJS
  const portTargets = Array.isArray(data.port_targets) ? data.port_targets : [];
  
  const primaryType = types[0] || 'PLC';
  const primaryRatio = ratios[0] || '1:8';

  const transaction = db.transaction((odpId, formData) => {
    // 1. Update data utama ODP
    updateOdpStmt.run(
      formData.name,
      formData.parent_odp_id ? parseInt(formData.parent_odp_id) : null,
      primaryType,
      primaryRatio,
      formData.input_power_dbm !== undefined && formData.input_power_dbm !== null && formData.input_power_dbm !== '' ? parseFloat(formData.input_power_dbm) : -9.0,
      formData.olt_id ? parseInt(formData.olt_id) : null,
      formData.pon_port || '',
      formData.port_capacity !== undefined && formData.port_capacity !== null ? parseInt(formData.port_capacity) : 16,
      formData.lat || '',
      formData.lng || '',
      formData.description || '',
      odpId
    );

    // 2. Hapus data splitter & port lama
    db.prepare('DELETE FROM odp_ports WHERE odp_id = ?').run(odpId);
    db.prepare('DELETE FROM odp_box_splitters WHERE odp_id = ?').run(odpId);

    const insertSplitter = db.prepare(`
      INSERT INTO odp_box_splitters (odp_id, splitter_index, splitter_type, splitter_ratio)
      VALUES (?, ?, ?, ?)
    `);

    const insertPort = db.prepare(`
      INSERT INTO odp_ports (odp_id, splitter_id, port_number, splitter_index, target_type, target_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    let targetIndex = 0;
    for (let i = 0; i < types.length; i++) {
      if (types[i]) {
        const sType = types[i];
        const sRatio = ratios[i] || '1:8';
        const splitterRes = insertSplitter.run(odpId, i + 1, sType, sRatio);
        const splitterId = splitterRes.lastInsertRowid;

        const portCount = getPortCountFromRatio(sType, sRatio);
        for (let p = 1; p <= portCount; p++) {
          let tType = 'EMPTY';
          let tId = null;

          if (portTargets[targetIndex]) {
            const rawTarget = String(portTargets[targetIndex]);
            if (rawTarget.startsWith('CUSTOMER_')) {
              tType = 'CUSTOMER';
              tId = parseInt(rawTarget.replace('CUSTOMER_', ''), 10);
            } else if (rawTarget.startsWith('CHILD_ODP_')) {
              tType = 'CHILD_ODP';
              tId = parseInt(rawTarget.replace('CHILD_ODP_', ''), 10);
              
              // 👈 FITUR UTAMA: Jika port ini diarahkan ke ODP Anak, jadikan ODP tersebut sebagai parent-nya secara otomatis!
              db.prepare('UPDATE odps SET parent_odp_id = ? WHERE id = ?').run(tId, odpId);
            }
          }

          insertPort.run(odpId, splitterId, p, i + 1, tType, tId);
          targetIndex++;
        }
      }
    }
  });

  return transaction(id, data);
}

function deleteOdp(id) {
  const transaction = db.transaction((odpId) => {
    db.prepare('DELETE FROM odp_ports WHERE odp_id = ?').run(odpId);
    db.prepare('DELETE FROM odp_box_splitters WHERE odp_id = ?').run(odpId);
    return db.prepare('DELETE FROM odps WHERE id = ?').run(odpId);
  });
  return transaction(id);
}

function getOdpPortUsage(odpId) {
  const odp = getOdpById(odpId);
  if (!odp) return null;
  
  const ports = odp.ports || [];
  const capacity = Number(odp.port_capacity || 16) || 16;
  const usedCount = ports.filter(p => p.target_type && p.target_type !== 'EMPTY').length;
  const remaining = Math.max(0, capacity - usedCount);
  
  return { odpId: Number(odpId), capacity, usedCount, remaining, ports };
}

module.exports = {
  getAllOdps,
  getOdpById,
  createOdp,
  updateOdp,
  deleteOdp,
  getOdpPortUsage
};
