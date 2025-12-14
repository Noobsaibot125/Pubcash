const geoip = require('geoip-lite');

/**
 * Middleware de restriction gÃ©ographique
 * Bloque l'accÃ¨s si l'IP de l'utilisateur n'est pas localisÃ©e en CÃ´te d'Ivoire (CI).
 */
const geoMiddleware = (req, res, next) => {
    // 1. RÃ©cupÃ©rer l'IP du client
    // En prod derriÃ¨re un proxy (Nginx/Apache), l'IP rÃ©elle est souvent dans 'x-forwarded-for'
    let ip = req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        (req.connection.socket ? req.connection.socket.remoteAddress : null);

    // GÃ©rer le cas des IP multiples (ex: "client_ip, proxy_ip")
    if (ip && ip.includes(',')) {
        ip = ip.split(',')[0].trim();
    }

    // Nettoyer le prÃ©fixe IPv6 mapped IPv4 (ex: "::ffff:127.0.0.1")
    if (ip && ip.includes('::ffff:')) {
        ip = ip.split(':').pop();
    }

    // 2. Autoriser localhost et les rÃ©seaux locaux pour le dÃ©veloppement
    // 127.0.0.1, ::1, 192.168.x.x, 10.x.x.x, 172.16-31.x.x
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.') || (ip.startsWith('172.') && ip.split('.')[1] >= 16 && ip.split('.')[1] <= 31)) {
        // console.log(`[GeoIP] IP locale dÃ©tectÃ©e: ${ip} - AccÃ¨s autorisÃ© (Dev/Local)`);
        return next();
    }

    // 3. VÃ©rification gÃ©ographique
    const geo = geoip.lookup(ip);

    // Si l'IP est introuvable (geo est null), on bloque par sÃ©curitÃ© (ou on loggue)
    // "CI" est le code ISO pour CÃ´te d'Ivoire
    if (geo && geo.country === 'CI') {
        return next();
    }

    // Bloquer l'accÃ¨s
    console.warn(`[GeoIP] AccÃ¨s refusÃ© pour l'IP ${ip} (${geo ? geo.country : 'Inconnu'})`);
    return res.status(403).json({
        error: 'Access denied',
        message: 'Ce service est uniquement accessible depuis la CÃ´te d\'Ivoire.'
    });
};

module.exports = geoMiddleware;
