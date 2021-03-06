const passport = require('passport');
const passportJWT = require('passport-jwt');
const passportHTTP = require('passport-http');
const bcrypt = require('bcrypt');
const diskLogic = require('logic/disk.js');
const authLogic = require('logic/auth.js');
const NodeError = require('models/errors.js').NodeError;
const rsa = require('node-rsa');
const UUID = require('utils/UUID');

var JwtStrategy = passportJWT.Strategy;
var BasicStrategy = passportHTTP.BasicStrategy;
var ExtractJwt = passportJWT.ExtractJwt;

const saltRounds = 10;

const SYSTEM_USER = UUID.fetchBootUUID() || 'admin';
const JWT_AUTH = 'jwt';
const REGISTRATION_AUTH = 'register';
const BASIC_AUTH = 'basic';

async function generateJWTKeys() {
  const key = new rsa({b: 512}); // eslint-disable-line id-length

  const privateKey = key.exportKey('private');
  const publicKey = key.exportKey('public');

  await diskLogic.writeJWTPrivateKeyFile(privateKey);
  await diskLogic.writeJWTPublicKeyFile(publicKey);
}

async function createJwtOptions() {
  await generateJWTKeys();
  const pubKey = await diskLogic.readJWTPublicKeyFile();

  return {
    jwtFromRequest: ExtractJwt.fromAuthHeaderWithScheme('jwt'),
    secretOrKey: pubKey,
    algorithm: 'RS256'
  };
}

passport.serializeUser(function(user, done) {
  return done(null, SYSTEM_USER);
});

passport.use(BASIC_AUTH, new BasicStrategy(function(username, password, next) {
  return next(null, {password: password, username: SYSTEM_USER}); // eslint-disable-line object-shorthand
}));

createJwtOptions().then(function(data) {
  const jwtOptions = data;

  passport.use(JWT_AUTH, new JwtStrategy(jwtOptions, function(jwtPayload, done) {
    return done(null, {username: SYSTEM_USER});
  }));
});

passport.use(REGISTRATION_AUTH, new BasicStrategy(function(username, password, next) {
  bcrypt.hash(password, saltRounds).then(function(hash) {
    return next(null, {password: hash, username: SYSTEM_USER});
  });
}));

function basic(req, res, next) {
  passport.authenticate(BASIC_AUTH, {session: false}, function(error, user) {

    function handleCompare(equal) {
      if (!equal) {
        return next(new NodeError('Incorrect password', 401)); // eslint-disable-line no-magic-numbers
      }
      req.logIn(user, function(err) {
        if (err) {
          return next(new NodeError('Unable to authenticate', 401)); // eslint-disable-line no-magic-numbers
        }
        delete user.password;

        return next(null, user);
      });
    }

    diskLogic.readUserFile()
      .then(userData => {
        const storedPassword = userData.password;

        if (error || user === false) {
          return next(new NodeError('Invalid state', 401)); // eslint-disable-line no-magic-numbers
        }

        bcrypt.compare(user.password, storedPassword)
          .then(handleCompare)
          .catch(next);
      })
      .catch(() => next(new NodeError('No user registered', 401))); // eslint-disable-line no-magic-numbers
  })(req, res, next);
}

function jwt(req, res, next) {
  passport.authenticate(JWT_AUTH, {session: false}, function(error, user) {
    if (error || user === false) {
      return next(new NodeError('Invalid JWT', 401)); // eslint-disable-line no-magic-numbers
    }
    req.logIn(user, function(err) {
      if (err) {
        return next(new NodeError('Unable to authenticate', 401)); // eslint-disable-line no-magic-numbers
      }

      return next(null, user);
    });
  })(req, res, next);
}

async function accountJWTProtected(req, res, next) {
  const isRegistered = await authLogic.isRegistered();
  if (isRegistered.registered) {
    passport.authenticate(JWT_AUTH, {session: false}, function(error, user) {
      if (error || user === false) {
        return next(new NodeError('Invalid JWT', 401)); // eslint-disable-line no-magic-numbers
      }
      req.logIn(user, function(err) {
        if (err) {
          return next(new NodeError('Unable to authenticate', 401)); // eslint-disable-line no-magic-numbers
        }

        return next(null, user);
      });
    })(req, res, next);
  } else {
    return next(null, 'not-registered');
  }
}

function register(req, res, next) {
  passport.authenticate(REGISTRATION_AUTH, {session: false}, function(error, user) {
    if (error || user === false) {
      return next(new NodeError('Invalid state', 401)); // eslint-disable-line no-magic-numbers
    }
    req.logIn(user, function(err) {
      if (err) {
        return next(new NodeError('Unable to authenticate', 401)); // eslint-disable-line no-magic-numbers
      }

      return next(null, user);
    });
  })(req, res, next);
}

module.exports = {
  basic,
  jwt,
  register,
  accountJWTProtected,
};

