const fs = require('node:fs');
const path = require('node:path');

const gradleFile = path.join(
  __dirname,
  '..',
  'node_modules',
  'onnxruntime-react-native',
  'android',
  'build.gradle',
);

if (!fs.existsSync(gradleFile)) {
  process.exit(0);
}

const original = 'if (VersionNumber.parse(REACT_NATIVE_VERSION) < VersionNumber.parse("0.71")) {';
const compatible = "if (REACT_NATIVE_VERSION.startsWith('0.') && REACT_NATIVE_VERSION.tokenize('.')[1].toInteger() < 71) {";
let contents = fs.readFileSync(gradleFile, 'utf8');

if (contents.includes(original)) {
  contents = contents.replace(original, compatible);
  console.log('Applied ONNX Runtime Gradle 9 compatibility fix.');
} else if (!contents.includes(compatible)) {
  throw new Error(`Unexpected ONNX Runtime Gradle script; cannot apply compatibility fix: ${gradleFile}`);
}

const misplacedPageSizeArgument = `  externalNativeBuild {
    cmake {
      arguments "-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON"
      path "CMakeLists.txt"
    }
  }`;
const normalNativeBuild = `  externalNativeBuild {
    cmake {
      path "CMakeLists.txt"
    }
  }`;
if (contents.includes(misplacedPageSizeArgument)) {
  contents = contents.replace(misplacedPageSizeArgument, normalNativeBuild);
}

const rnCmakeArgument = '"-DUSE_NNAPI=${!useQnn}"';
const rnCmakeArgumentsWith16k = `${rnCmakeArgument},\n            "-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON"`;
contents = contents.replaceAll(',\n            "-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON"', '');
const rnCmakeArgumentCount = contents.split(rnCmakeArgument).length - 1;
if (rnCmakeArgumentCount === 2) {
  contents = contents.replaceAll(rnCmakeArgument, rnCmakeArgumentsWith16k);
  console.log('Enabled flexible 16 KB page sizes for the ONNX Runtime native build.');
} else {
  throw new Error(`Unexpected ONNX Runtime CMake arguments: ${gradleFile}`);
}

const linkLibraries = `target_link_libraries(
  onnxruntimejsi`;
const linkOptions16k = `target_link_options(
  onnxruntimejsi
  PRIVATE
  "-Wl,-z,max-page-size=16384"
  "-Wl,-z,common-page-size=16384")

target_link_libraries(
  onnxruntimejsi`;

const cmakeFile = path.join(path.dirname(gradleFile), 'CMakeLists.txt');
let cmake = fs.readFileSync(cmakeFile, 'utf8');
if (!cmake.includes('"-Wl,-z,max-page-size=16384"')) {
  if (!cmake.includes(linkLibraries)) {
    throw new Error(`Unexpected ONNX Runtime linker configuration: ${cmakeFile}`);
  }
  cmake = cmake.replace(linkLibraries, linkOptions16k);
  fs.writeFileSync(cmakeFile, cmake);
  console.log('Enabled 16 KB ELF alignment for libonnxruntimejsi.so.');
}

fs.writeFileSync(gradleFile, contents);
