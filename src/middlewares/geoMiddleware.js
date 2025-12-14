const geoip = require('geoip-lite');

/**
 * Middleware de restriction gÃ©ographique
 * Bloque l'accÃ¨s si l'IP de l'utilisateur n'est pas localisÃ©e en CÃ´te d'Ivoire (CI).
 */
const geoMiddleware = (req, res, next) => {
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
    // console.log(`[GeoIP Debug] Incoming IP: ${ip} | Geo: ${geo ? geo.country : 'null'} | Headers:`, req.headers['x-forwarded-for']);

    // 2. IMPORTANT : Ne PAS whitelister localhost bÃªtement en PROD si on est derriÃ¨re un proxy
    // Si le serveur Node est derriÃ¨re Nginx local, tout vient de 127.0.0.1.
    // IL FAUT S'ASSURER QUE req.ip est la VRAIE IP.

    // Pour le test, on va logger tout Ã§a.
    // Si on est en dev local (ta machine), on laisse passer.
    // En prod, si l'IP est 127.0.0.1, c'est que le proxy n'est pas bien gÃ©rÃ© ou que c'est le serveur lui-mÃªme.

    // Modif: Si l'ip est privée, on laisse passer UNIQUEMENT si on n'est pas sûr de l'origine
    // MAIS ici le problème est que le client USA est vu comme autorisé.
    // Donc soit il est vu comme CI (peu probable), soit il est vu comme Localhost/Private (TRÈS PROBABLE via Proxy).

    // Whitelist IP locales (Dev uniquement)
    // On suppose que sur le serveur de prod, l'IP publique entrante ne sera JAMAIS privée si 'trust proxy' est bon.
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
        // ATTENTION: C'est ici le piÃ¨ge. Si Nginx retransmet sans X-Forwarded-For, c'est 127.0.0.1.
        // On va laisser passer pour ne pas casser le dev local, MAIS on va logger un warning.
        // console.log(`[GeoIP] AccÃ¨s Localhost autorisÃ©: ${ip}`);
        return next();
    }

    // 3. VÃ©rification gÃ©ographique
    // "CI" est le code ISO pour CÃ´te d'Ivoire
    if (geo && geo.country === 'CI') {
        return next();
    }

    // Bloquer l'accÃ¨s
    console.warn(`[GeoIP] BLOCKED IP: ${ip} | Country: ${geo ? geo.country : 'Unknown'}`);
    return res.status(403).json({
        error: 'Access denied',
        message: 'Ce service est uniquement accessible depuis la CÃ´te d\'Ivoire.',
        debug_ip: ip, // Retourner l'IP pour qu'il puisse nous dire ce qu'il voit
        debug_country: geo ? geo.country : 'Unknown'
    });
};

module.exports = geoMiddleware;
