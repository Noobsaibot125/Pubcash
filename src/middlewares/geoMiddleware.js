const geoip = require('geoip-lite');

/**
 * Bloque l'accÃ¨s si l'IP de l'utilisateur n'est pas localisÃ©e en CÃ´te d'Ivoire (CI).
 */
const geoMiddleware = (req, res, next) => {
    // 0. Whitelist des routes critiques qui ne doivent JAMAIS Ãªtre bloquÃ©es par GeoIP
    const allowedPrefixes = ['/api/settings', '/health', '/api/auth/login-admin'];
    if (allowedPrefixes.some(prefix => req.path.startsWith(prefix))) {
        return next();
    }

    // 1. RÃ©cupÃ©rer l'IP du client
    // En prod derriÃ¨re un proxy (Nginx/Apache), l'IP rÃ©elle est souvent dans 'x-forwarded-for'
    // Express avec 'trust proxy' activÃ© remplit req.ip correctement
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

    // --- LOGGING POUR DEBUG (A VOIR DANS LES LOGS DU SERVEUR) ---
    const geo = geoip.lookup(ip);

    // CAS 1 : C'est confirmé comme étant la Côte d'Ivoire
    if (geo && geo.country === 'CI') {
        return next();
    }

    // CAS 2 (LE SAUVETAGE) : L'IP est inconnue dans la base de données
    // Les IPs locales changent souvent et geoip-lite peut avoir du retard.
    // On laisse passer les "Unknown" pour ne pas bloquer les vrais clients ivoiriens.
    if (!geo || !geo.country) {
        console.log(`[GeoIP] WARN: IP Inconnue autorisée (Bénéfice du doute) : ${ip}`);
        return next();
    }

    // CAS 3 : On est SÛR que ce n'est PAS la Côte d'Ivoire (ex: 'US', 'FR')
    console.warn(`[GeoIP] BLOCKED IP: ${ip} | Country: ${geo.country}`);
    return res.status(403).json({
        error: 'Access denied',
        message: 'Ce service est uniquement accessible depuis la Côte d\'Ivoire.',
        debug_ip: ip,
        debug_country: geo.country
    });
};

module.exports = geoMiddleware;
