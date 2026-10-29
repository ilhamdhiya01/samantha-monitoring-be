// @nestjs/config v12 adalah ESM murni; Jest (CommonJS) tidak bisa
// memuatnya. Spec membuat ConfigService tiruan sendiri ({ get }), jadi
// cukup kelas kosong untuk metadata DI.
export class ConfigService {}
export class ConfigModule {}
