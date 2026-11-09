/**
 * Helper untuk menghitung redaman jaringan Fiber Optik (FTTH)
 */

// Standar redaman komponen (Loss dalam dB)
const CABLE_LOSS_PER_KM = 0.35; // Redaman kabel G.652D per kilometer (dB/km)
const CONNECTOR_LOSS = 0.3;     // Redaman per titik Fast Connector / Pigtail (dB)
const SPLICING_LOSS = 0.1;      // Redaman per titik Fusion Splicing (dB)

/**
 * Menghitung redaman berdasarkan jenis splitter
 * @param {string} type - 'PLC' atau 'FBT'
 * @param {string} ratio - Contoh: '1:8' untuk PLC, atau '10:90' untuk FBT
 * @returns {number} Nilai redaman (dB)
 */
function calculateSplitterLoss(type, ratio) {
  if (!type || !ratio) return 0;
  
  const cleanType = type.toUpperCase();
  
  if (cleanType === 'PLC') {
    // Standar redaman PLC Splitter simetris (dB)
    const plcLossTable = {
      '1:2': 3.7,
      '1:4': 7.4,
      '1:8': 10.5,
      '1:16': 13.8,
      '1:32': 17.5,
      '1:64': 21.0
    };
    return plcLossTable[ratio] || 10.5; // Default 1:8 jika tidak ditemukan
  } 
  else if (cleanType === 'FBT') {
    // Format FBT Asimetris, misal "10:90" atau "20:80"
    // Kita ambil porsi terkecil atau jalur yang dicabang (misal porsi cabang untuk pelanggan)
    const parts = ratio.split(':');
    if (parts.length === 2) {
      const p1 = parseFloat(parts[0]);
      const p2 = parseFloat(parts[1]);
      const total = p1 + p2;
      if (total > 0) {
        // Ambil porsi jalur cabang (nilai yang paling kecil, atau sesuai logika Anda)
        const branchRatio = Math.min(p1, p2) / total;
        // Rumus Redaman FBT: -10 * log10(persentase desimal)
        if (branchRatio > 0) {
          return parseFloat((-10 * Math.log10(branchRatio)).toFixed(2));
        }
      }
    }
    return 3.0; // Fallback default FBT
  }
  
  return 0;
}

/**
 * Kalkulasi total link budget redaman sampai ke titik tujuan
 * @param {number} inputPowerDbm - Redaman awal / input dari hulu (dBm), contoh: -9.0
 * @param {number} distanceMeters - Panjang kabel dalam meter
 * @param {string} splitterType - 'PLC' atau 'FBT'
 * @param {string} splitterRatio - Rasio splitter, misal '1:8' atau '10:90'
 * @param {number} connectors - Jumlah konektor (default: 2)
 * @param {number} splices - Jumlah titik sambung/splicing (default: 1)
 * @returns {object} Hasil perhitungan (total loss dan sisa power akhir dBm)
 */
function calculateLinkBudget(inputPowerDbm, distanceMeters, splitterType, splitterRatio, connectors = 2, splices = 1) {
  const km = (distanceMeters || 0) / 1000;
  
  const cableLoss = km * CABLE_LOSS_PER_KM;
  const splitterLoss = calculateSplitterLoss(splitterType, splitterRatio);
  const connLoss = (connectors || 0) * CONNECTOR_LOSS;
  const spliceLoss = (splices || 0) * SPLICING_LOSS;
  
  const totalLoss = parseFloat((cableLoss + splitterLoss + connLoss + spliceLoss).toFixed(2));
  const finalPowerDbm = parseFloat(((inputPowerDbm || 0) - totalLoss).toFixed(2));
  
  // Status kelayakan (Standar ONU biasanya -10 dBm s.d -25 dBm. Di bawah -27 dBm biasanya LOS/Warning)
  let status = 'GOOD';
  if (finalPowerDbm < -27) {
    status = 'CRITICAL_LOS'; // Risiko tinggi Loss Of Signal
  } else if (finalPowerDbm < -24) {
    status = 'WARNING';      // Mendekati batas toleransi ONU
  }

  return {
    inputPowerDbm: Number(inputPowerDbm || 0),
    cableLoss: parseFloat(cableLoss.toFixed(2)),
    splitterLoss,
    connectorLoss: parseFloat(connLoss.toFixed(2)),
    splicingLoss: parseFloat(spliceLoss.toFixed(2)),
    totalLoss,
    finalPowerDbm,
    status
  };
}

module.exports = {
  calculateSplitterLoss,
  calculateLinkBudget
};
