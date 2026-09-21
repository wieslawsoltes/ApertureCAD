import { ModelBuilder, TYPE, FLAGS, rgba } from './index.js';
/** Original, fictional process-campus drawing. Every mark is an ordinary GPU entity. */
export function makeCampus(font) {
    const layers = [['A-STRUCTURE', '#788eaa'], ['P-PROCESS', '#5dd1bf'], ['E-EQUIPMENT', '#dca36d'], ['I-INSTRUMENTS', '#a998e2'], ['A-TEXT', '#b6c5d7'], ['A-DIMENSIONS', '#667d96'], ['E-DETAIL', '#678b9c'], ['A-SITE', '#40556c']].map(([name, color]) => ({ name, color: rgba(color), visible: true }));
    const b = new ModelBuilder(font, { name: 'Eastworks / Process Campus', layers });
    const L = (a, c, layer = 0) => b.line(a, c, layer);
    const R = (x, y, w, h, layer = 0) => b.rect(x, y, w, h, layer);
    const T = (s, x, y, h = 7, layer = 4) => b.text(s, x, y, h, layer);
    const C = (x, y, r, layer = 2) => b.circle(x, y, r, layer);
    function pipe(points, layer = 1) { b.add({ type: TYPE.POLYLINE, anchor: points[0], points, layer }); }
    function arrow(x, y, dx, dy, layer = 5) { b.add({ type: TYPE.TRIANGLE, anchor: [x, y], p: [dx - dy * .4, dy + dx * .4, dx + dy * .4, dy - dx * .4], layer }); }
    function dimension(x, y, w, label) { L([x, y], [x + w, y], 5); L([x, y - 8], [x, y + 8], 5); L([x + w, y - 8], [x + w, y + 8], 5); arrow(x, y, 6, 0); arrow(x + w, y, -6, 0); T(label, x + w * .5 - label.length * 2.3, y + 6, 6, 5); }
    function valve(x, y, vertical = false) { if (!vertical) {
        b.add({ type: TYPE.POLYLINE, anchor: [x - 5, y - 4], points: [[x - 5, y - 4], [x + 5, y + 4], [x + 5, y - 4], [x - 5, y + 4], [x - 5, y - 4]], layer: 1 });
    }
    else {
        b.add({ type: TYPE.POLYLINE, anchor: [x - 4, y - 5], points: [[x - 4, y - 5], [x + 4, y + 5], [x - 4, y + 5], [x + 4, y - 5], [x - 4, y - 5]], layer: 1 });
    } }
    function pump(x, y, id) { C(x, y, 12); C(x, y, 8); R(x + 14, y - 8, 20, 16, 2); L([x + 19, y - 6], [x + 19, y + 6], 6); L([x + 23, y - 6], [x + 23, y + 6], 6); L([x + 27, y - 6], [x + 27, y + 6], 6); L([x - 17, y], [x - 12, y], 1); L([x + 12, y], [x + 14, y], 1); L([x, y + 12], [x, y + 23], 1); valve(x, y + 19, true); R(x - 15, y - 14, 52, 29, 6); T('P-' + String(id).padStart(4, '0'), x - 12, y - 24, 5.1); T('45 kW', x + 16, y + 19, 4.4, 6); }
    function rack(x, y, id) { R(x, y, 38, 58, 2); R(x + 3, y + 3, 32, 52, 6); for (let j = 0; j < 9; j++) {
        L([x + 5, y + 7 + j * 5], [x + 33, y + 7 + j * 5], 6);
        for (let k = 0; k < 5; k++)
            C(x + 8 + k * 5, y + 9 + j * 5, .7, 6);
    } T('HX-' + id, x, y - 8, 5.2); L([x + 10, y + 58], [x + 10, y + 64], 1); L([x + 28, y + 58], [x + 28, y + 64], 1); }
    R(35, 35, 1895, 1160, 0);
    R(44, 44, 1877, 1142, 7);
    for (let x = 75; x < 1900; x += 50) {
        L([x, 1180], [x, 1186], 7);
        L([x, 44], [x, 50], 7);
    }
    for (let y = 80; y < 1170; y += 50) {
        L([44, y], [50, y], 7);
        L([1915, y], [1921, y], 7);
    }
    T('EASTWORKS', 83, 1126, 25, 4);
    T('PROCESS CAMPUS  /  GENERAL ARRANGEMENT', 84, 1103, 9, 5);
    T('MODEL SPACE  .  ENGINEERING DEMONSTRATION', 1370, 1146, 6, 5);
    T('N', 1848, 1094, 9, 4);
    L([1850, 1055], [1850, 1084], 5);
    arrow(1850, 1086, 0, -10);
    C(1850, 1055, 8, 5);
    // Main process train: 48 detailed pumps and pipe manifolds.
    R(105, 555, 765, 455);
    R(111, 561, 753, 443, 7);
    T('01', 122, 969, 18, 1);
    T('PROCESS HALL A', 164, 979, 11);
    T('PRIMARY CIRCULATION / DUTY + STANDBY', 164, 962, 5.8, 5);
    for (let row = 0; row < 6; row++) {
        const y = 600 + row * 57;
        L([123, y + 29], [846, y + 29], 1);
        L([123, y + 32], [846, y + 32], 6);
        for (let col = 0; col < 8; col++) {
            const x = 143 + col * 89;
            pump(x, y, 2100 + row * 8 + col);
            pipe([[x, y + 23], [x, y + 29]]);
            if (col < 7)
                valve(x + 54, y + 29);
        }
    }
    for (let x = 120; x < 864; x += 100) {
        R(x, 556, 8, 8);
        R(x, 997, 8, 8);
    }
    for (let y = 560; y < 1000; y += 100) {
        R(106, y, 8, 8);
        R(858, y, 8, 8);
    }
    dimension(105, 1031, 765, '76 500');
    // Heat exchange galleries: each tiny detail remains selectable.
    R(920, 650, 470, 360);
    R(926, 656, 458, 348, 7);
    T('02', 936, 969, 18, 1);
    T('THERMAL GALLERY', 978, 979, 10);
    T('HEAT EXCHANGE / MODULAR UNITS', 978, 962, 5.3, 5);
    for (let row = 0; row < 3; row++) {
        const y = 688 + row * 84;
        for (let col = 0; col < 7; col++)
            rack(944 + col * 62, y, 300 + row * 7 + col);
        L([936, y + 65], [1370, y + 65], 1);
    }
    dimension(920, 1031, 470, '47 000');
    // Storage vessels with ring details, bolts, nozzle and instrument loops.
    R(1440, 555, 435, 455);
    T('03', 1455, 969, 18, 1);
    T('VESSEL FARM', 1498, 979, 11);
    T('CLOSED-LOOP / 12 BAR DESIGN', 1498, 962, 5.5, 5);
    for (let row = 0; row < 3; row++)
        for (let col = 0; col < 3; col++) {
            const x = 1512 + col * 143, y = 627 + row * 116;
            C(x, y, 43);
            C(x, y, 38, 6);
            C(x, y, 10, 6);
            C(x, y, 5, 2);
            for (let j = 0; j < 16; j++) {
                const a = j * Math.PI / 8;
                C(x + 40.5 * Math.cos(a), y + 40.5 * Math.sin(a), 1.2, 6);
            }
            L([x - 48, y], [x + 48, y], 5);
            L([x, y - 48], [x, y + 48], 5);
            T('V-' + (401 + row * 3 + col), x - 15, y + 17, 6.5);
            T('Ø 8 600', x - 18, y - 23, 5.2, 5);
            C(x + 52, y + 28, 8, 3);
            T('PI', x + 47, y + 25, 5, 3);
            pipe([[x + 40, y + 18], [x + 52, y + 18], [x + 52, y + 20]], 3);
            L([x, y - 43], [x, y - 56], 1);
            valve(x, y - 52, true);
        }
    // Electrical/control wing.
    R(105, 205, 640, 280);
    T('04', 121, 445, 18, 1);
    T('POWER + CONTROL', 164, 455, 11);
    T('MCC / CONTROL ROOM / SERVICE ACCESS', 164, 439, 5.5, 5);
    for (let col = 0; col < 4; col++) {
        const x = 120 + col * 151;
        R(x, 224, 140, 195, 0);
        T(['CONTROL', 'MCC-A', 'MCC-B', 'UPS / LV'][col], x + 9, 401, 6.2);
        for (let row = 0; row < 3; row++)
            for (let unit = 0; unit < 4; unit++) {
                let xx = x + 10 + unit * 30, yy = 242 + row * 47;
                R(xx, yy, 24, 34, 2);
                for (let k = 0; k < 6; k++)
                    L([xx + 4, yy + 5 + k * 4], [xx + 20, yy + 5 + k * 4], 6);
                C(xx + 18, yy + 29, 1.2, 1);
                T(String(101 + row * 4 + unit), xx + 4, yy + 37, 4.3, 6);
            }
        L([x + 12, 231], [x + 128, 231], 1);
    }
    // Utility loop and coolant skid.
    R(790, 205, 600, 280);
    T('05', 806, 445, 18, 1);
    T('UTILITY SKIDS', 850, 455, 11);
    T('SECONDARY CIRCUIT / CHILLED WATER', 850, 439, 5.5, 5);
    for (let r = 0; r < 2; r++)
        for (let c = 0; c < 4; c++) {
            let x = 830 + c * 138, y = 270 + r * 89;
            R(x - 12, y - 22, 114, 62, 7);
            pump(x + 4, y, 3100 + r * 4 + c);
            R(x + 49, y - 10, 36, 27, 2);
            for (let z = 0; z < 7; z++)
                L([x + 53 + z * 4, y - 7], [x + 53 + z * 4, y + 14], 6);
            pipe([[x - 20, y], [x - 8, y]]);
            T('SKID ' + (r * 4 + c + 1), x + 52, y + 26, 5);
        }
    // Vertical circulation and main headers.
    for (let offset = 0; offset < 4; offset++) {
        const y = 510 + offset * 8;
        pipe([[85, y], [1414, y], [1414, 585 + offset * 8], [1887, 585 + offset * 8]], offset % 2 ? 6 : 1);
        for (let x = 155; x < 1360; x += 225)
            valve(x, y);
    }
    for (let offset = 0; offset < 3; offset++) {
        const x = 888 + offset * 7;
        pipe([[x, 224], [x, 1054], [1823, 1054 + offset * 7], [1823, 1015]], offset === 0 ? 1 : 6);
    }
    for (let y = 610; y < 950; y += 114)
        pipe([[870, y], [888, y]], 1);
    for (let x = 270; x < 1350; x += 140) {
        pipe([[x, 485], [x, 508]], 1);
    }
    // Laboratory / sample area with benches.
    R(1440, 205, 435, 280);
    T('06', 1456, 445, 18, 1);
    T('ANALYTICS LAB', 1498, 455, 11);
    T('QUALITY ASSURANCE / SAMPLING', 1498, 439, 5.5, 5);
    for (let row = 0; row < 4; row++)
        for (let col = 0; col < 4; col++) {
            const x = 1455 + col * 102, y = 232 + row * 44;
            R(x, y, 88, 28, 0);
            R(x + 4, y + 4, 30, 20, 6);
            for (let k = 0; k < 4; k++) {
                C(x + 43 + k * 10, y + 14, 3.2, 3);
                L([x + 40 + k * 10, y + 14], [x + 46 + k * 10, y + 14], 6);
            }
            T('LAB-' + (row * 4 + col + 1), x + 6, y + 10, 4.4);
        }
    dimension(105, 177, 1770, '177 000  /  OVERALL');
    // Drawing title block and legend.
    R(74, 72, 1815, 67, 5);
    L([1150, 72], [1150, 139], 5);
    L([1590, 72], [1590, 139], 5);
    L([1742, 72], [1742, 139], 5);
    T('APERTURE  /  ENGINEERING SYSTEMS', 90, 114, 12);
    T('EASTWORKS CAMPUS . XY COORDINATES IN MILLIMETRES . NOT FOR CONSTRUCTION', 91, 90, 5.6, 5);
    T('GENERAL ARRANGEMENT', 1169, 117, 9);
    T('PROCESS + UTILITIES', 1169, 99, 7, 5);
    T('100% COMPUTE RASTERIZATION', 1169, 84, 5.8, 1);
    T('DRAWING NO.', 1605, 123, 5, 5);
    T('EW-P-042', 1605, 101, 12);
    T('REVISION', 1758, 123, 5, 5);
    T('B.03', 1758, 100, 13);
    T('SCALE  1 : 250', 1758, 84, 5.5, 5);
    const result = b.finish();
    result.demo = true;
    result.diagnostics = [];
    return result;
}
