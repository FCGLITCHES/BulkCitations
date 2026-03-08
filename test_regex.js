const str = '2019;Vol. 76, No. 8:2341-58';
const regex = /(\d{4});([^(:]+)(?:\(([^)]+)\))?(?::(.*?))?(?=\s*$|\s+[^a-z])/;
console.log(str.match(regex));
