var _ = require('underscore');
var Promise = require('bluebird');
var expect = require('chai').expect;
var retry = require('../lib/bluebird-retry');

var now = {
    success: function() {
        return true;
    },

    failure: function() {
        throw new Error('not yet');
    },

    successAfter: function(count, ExpectedError) {
        var n = 0;
        return function() {
            if (++n === count) {
                return now.success();
            } else if (ExpectedError) {
                throw new ExpectedError('catch this');
            } else {
                return now.failure();
            }
        };
    }
};

var later = {
    success: function() {
        return Promise.resolve(true);
    },

    failure: function() {
        return Promise.reject(new Error('not yet'));
    },

    successAfter: function(count, ExpectedError) {
        var n = 0;
        return function() {
            if (++n === count) {
                return later.success();
            } else if (ExpectedError) {
                return Promise.reject(new ExpectedError('catch this'));
            } else {
                return later.failure();
            }
        };
    },

    // This only makes sense in the case of promises
    delayFailure: function(delay) {
        return function() {
            return Promise.delay(delay).then(later.failure);
        };
    }
};

function Counter(func) {
    this.func = func;

    var self = this;
    this.call = function() {
        self.call.count++;
        return self.func.apply(self.func, arguments);
    };
    self.call.count = 0;
}

function countCalls(func) {
    var c = new Counter(func);
    return c.call;
}

describe('bluebird-retry', function() {
    _.each({
        'with non-promise functions': now,
        'with promise functions': later
    }, function(funcs, what) {
        describe(what, function() {
            it('succeeds immediately', function(done) {
                var countSuccess = countCalls(funcs.success);
                return retry(countSuccess)
                    .then(function(res) {
                        expect(res).equal(true);
                        expect(countSuccess.count).equal(1);
                    })
                    .done(done, done);
            });

            it('retries a few times', function(done) {
                var countSuccess = countCalls(funcs.successAfter(10));
                return retry(countSuccess, {interval: 10, max_tries: 10})
                    .then(function() {
                        expect(countSuccess.count).equal(10);
                    })
                    .done(done, done);
            });

            it('fails after a few tries', function(done) {
                var countSuccess = countCalls(funcs.successAfter(100));
                return retry(countSuccess, {interval: 10, max_tries: 10})
                    .then(function() {
                        throw new Error('unexpected success');
                    })
                    .caught(function(err) {
                        expect(err).match(/operation timed out.*not yet/);
                        expect(err.message).match(/operation timed out.*not yet/);
                        expect(err.failure).match(/not yet/);
                        expect(err.failure.message).match(/not yet/);
                        expect(countSuccess.count).equal(10);
                    })
                    .done(done, done);
            });

            it('handles rejection with a string', function(done) {
                function badfail() {
                    return Promise.reject('something bad happened')
                }
                return retry(badfail, {interval: 10, max_tries: 2})
                    .then(function() {
                        throw new Error('unexpected success');
                    })
                    .caught(function(err) {
                        expect(err).match(/operation timed out.*something bad happened/);
                        expect(err.message).match(/something bad happened/);
                        expect(err.message).match(/operation timed out/);
//                        expect(err.stack).match(/something bad happened/);
                        expect(err.failure.failure).equals('something bad happened');
                    })
                    .done(done, done);
            });

            it('handles rejection with a non-error item', function(done) {
                function badfail() {
                    return Promise.reject({'thrown': 'object'})
                }
                return retry(badfail, {interval: 10, max_tries: 2})
                    .then(function() {
                        throw new Error('unexpected success');
                    })
                    .caught(function(err) {
                        expect(err).match(/operation timed out.*{"thrown":"object"}/);
                        expect(err.message).match(/{"thrown":"object"}/);
                        expect(err.message).match(/operation timed out/);
//                        expect(err.stack).match(/{"thrown":"object"}/);
                        expect(err.failure.failure).equals('{"thrown":"object"}');
                    })
                    .done(done, done);
            });

            it('handles rejection with a NULL item', function(done) {
                function badfail() {
                    return Promise.reject(null)
                }
                return retry(badfail, {interval: 10, max_tries: 2})
                    .then(function() {
                        throw new Error('unexpected success');
                    })
                    .caught(function(err) {
                        expect(err).match(/operation timed out.*null/);
                        expect(err.message).match(/null/);
                        expect(err.message).match(/operation timed out/);
//                        expect(err.stack).match(/null/);
                        expect(err.failure.failure).is.null;
                    })
                    .done(done, done);
            });

            it('handles rejection with an undefined item', function(done) {
                function badfail() {
                    return Promise.reject(undefined)
                }
                return retry(badfail, {interval: 10, max_tries: 2})
                    .then(function() {
                        throw new Error('unexpected success');
                    })
                    .caught(function(err) {
                        expect(err).match(/operation timed out.*undefined/);
                        expect(err.message).match(/undefined/);
                        expect(err.message).match(/operation timed out/);
//                        expect(err.stack).match(/undefined/);
                        expect(err.failure.failure).is.undefined;
                    })
                    .done(done, done);
            });

            it('supports the throw_original option', function(done) {
                var original_err;
                function badfail() {
                    original_err = new Error('original error');
                    throw original_err;
                }
                return retry(badfail, {interval: 10, max_tries: 2, throw_original: true})
                    .then(function() {
                        throw new Error('unexpected success');
                    })
                    .caught(function(err) {
                        expect(err).equals(original_err);
                    })
                    .done(done, done);
            });

            it('calculates max_tries based on timeout', function(done) {
                var countSuccess = countCalls(funcs.successAfter(500));
                return retry(countSuccess, {interval: 50, timeout: 475})
                    .then(function() {
                        throw new Error('unexpected success');
                    })
                    .caught(function(err) {
                        expect(err.message).match(/operation timed out/);
                        expect(err.failure.message).match(/not yet/);
                        // Give a bit of leeway for bamboo
                        expect(countSuccess.count).within(8, 10);
                    })
                    .done(done, done);
            });

            it('calculates max_tries based on timeout and exponential interval', function(done) {
                var countSuccess = countCalls(funcs.successAfter(90));
                return retry(countSuccess, {interval: 20, timeout: 200, backoff: 5})
                    .then(function() {
                        throw new Error('unexpected success');
                    })
                    .caught(function(err) {
                        expect(err.message).match(/operation timed out/);
                        expect(err.failure.message).match(/not yet/);
                        expect(countSuccess.count).equal(3); // 20 + 100 + 500
                    })
                    .done(done, done);
            });

            it('calculates max_tries based on exponential interval with limit', function(done) {
                var countSuccess = countCalls(funcs.successAfter(100));
                return retry(countSuccess, {interval: 20, timeout: 200, backoff: 10, max_interval: 100})
                    .then(function() {
                        throw new Error('unexpected success');
                    })
                    .caught(function(err) {
                        expect(err.message).match(/operation timed out/);
                        expect(err.failure.message).match(/not yet/);
                        expect(countSuccess.count).equal(3); // 20 + 100 + 100
                    })
                    .done(done, done);
            });

            if (funcs.delayFailure) {
                it('includes time spent in the handler when computing timeout', function(done) {
                    var count = countCalls(funcs.delayFailure(250));
                    return retry(count, {interval: 20, timeout: 500})
                        .then(function() {
                            throw new Error('unexpected success');
                        })
                        .caught(function(err) {
                            expect(err.message).match(/operation timed out/);
                            expect(err.failure.message).match(/not yet/);
                            expect(count.count).equal(2);
                        })
                        .done(done, done);
                    });
            }

            it('can cancel the retry event loop', function() {
                // test various ways in which cancel() may be invoked
                // by the caller & verify it's output error message
                // ie. input arg => output Error message / type
                function MyError(message) {
                    this.name = 'MyError';
                    Error.call(this);
                    this.message = message;
                    this.is_my_error = true;
                }
                MyError.prototype = Object.create(Error.prototype);

                var test_args = [
                    [ undefined, 'cancelled' ],
                    [ 'stop retrying', 'stop retrying'],
                    [ new MyError('test my error'), 'test my error']
                ];
                var retry_opts = {interval: 10, max_tries: 5};

                return Promise.all(_.map(test_args, function(arg_type) {
                    var i = 0;
                    var err;
                    var op = function() {
                        i++;
                        if (i === 3) {
                            throw new retry.StopError(arg_type[0]);
                        }
                        throw new Error('keep trying');
                    };
                    return retry(op, retry_opts)
                    .caught(function(e) {
                        err = e;
                    })
                    .then(function() {
                        expect(i).to.equal(3);
                        expect(err.message).equal(arg_type[1]);
                        if (arg_type[0] instanceof MyError) {
                            expect(err instanceof MyError).is.true;
                            expect(err.is_my_error).is.true;
                        }
                    });
                }));
            });

            var predicates = {
                'error class': RangeError,
                'predicate function': function(err) { return err instanceof RangeError; }
            };

            _.each(predicates, function(predicate, what) {
                it('retries only when matching ' + what, function(done) {
                    var countSuccess = countCalls(funcs.successAfter(5, RangeError));
                    return retry(countSuccess, {
                        interval: 10,
                        max_tries: 10,
                        predicate: predicate
                    })
                        .then(function() {
                            expect(countSuccess.count).equal(5);
                        })
                        .done(done, done);
                });

                it('fails immediately with non matching ' + what, function(done) {
                    var countSuccess = countCalls(funcs.failure);
                    return retry(countSuccess, {
                        interval: 10,
                        max_tries: 10,
                        predicate: predicate
                    })
                        .then(function() {
                            throw new Error('unexpected success');
                        })
                        .caught(function(err) {
                            expect(err.message).match(/not yet/);
                            expect(countSuccess.count).equal(1);
                        })
                        .done(done, done);
                });

                it('fails after a few tries when matching ' + what, function(done) {
                    var countSuccess = countCalls(funcs.successAfter(100, RangeError));
                    return retry(countSuccess, {
                        interval: 10,
                        max_tries: 10,
                        predicate: predicate
                    })
                        .then(function() {
                            throw new Error('unexpected success');
                        })
                        .caught(function(err) {
                            expect(err.message).match(/operation timed out/);
                            expect(err.failure.message).match(/catch this/);
                            expect(countSuccess.count).equal(10);
                        })
                        .done(done, done);
                });
                
                it('supports optional context', function(done) {
                    var expected = {self: "this is my this"};
                    var context;
                    function func() {
                        context = this;
                    }
                    return retry(func, {context: expected})
                    .then(function() {
                        expect(context).equals(expected);
                    })
                    .done(done, done);
                });

                it('supports optional args', function(done) {
                    var expected = ["arg0", "arg1"];
                    var args;
                    function func() {
                        args = Array.prototype.slice.call(arguments);
                    }
                    return retry(func, {args: expected})
                    .then(function() {
                        expect(args).deep.equal(expected);
                    })
                    .done(done, done);
                });
            });
        });
    });
});
