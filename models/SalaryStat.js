const mongoose = require('mongoose');
const { Schema } = mongoose;

// Government salary statistics (987 docs). READ-ONLY from Node.
// This is NOT job posting salary: it reports what people in an occupation or
// industry actually earn. A posting's salaryRaw is one employer's current offer.
// Showing both side by side is useful; averaging them together is not.

const SALARY_SOURCE = Object.freeze({
  OCCUPATION: '職類別薪資調查',
  INDUSTRY: '薪情平台行業別',
});

const salaryStatSchema = new Schema(
  {
    // WARNING: mixes two granularities.
    //   source = 職類別薪資調查 -> an OCCUPATION (軟體工程師)
    //   source = 薪情平台行業別 -> an INDUSTRY   (製造業)
    // Always constrain by `source`, or you will silently compare an
    // occupation to an industry. Use byOccupation() / byIndustry() below.
    occupation: String,
    source: { type: String, enum: Object.values(SALARY_SOURCE) },
    avgMonthly: Number,
    year: Number,
    avgAnnual: Number,
    occupationCode: String,
    occupationLevel: String,
    industryScope: String,
    // Includes bonuses and overtime. Only the industry source has it, and it
    // reflects take-home pay far better in bonus-heavy sectors like finance.
    avgMonthlyTotal: Number,
    importedAt: Date,
  },
  { collection: 'salary_stats', strict: false, versionKey: false, timestamps: false }
);

salaryStatSchema.statics.byOccupation = function (name) {
  return this.find({ source: SALARY_SOURCE.OCCUPATION, occupation: name }).sort({ year: -1 });
};

salaryStatSchema.statics.byIndustry = function (name) {
  return this.find({ source: SALARY_SOURCE.INDUSTRY, occupation: name }).sort({ year: -1 });
};

const SalaryStat = mongoose.model('SalaryStat', salaryStatSchema);
module.exports = { SalaryStat, SALARY_SOURCE };
