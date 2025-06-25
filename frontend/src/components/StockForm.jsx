import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { motion } from 'framer-motion';

const schema = yup.object({
  ticker: yup
    .string()
    .required('Ticker symbol is required')
    .uppercase()
    .max(5, 'Max 5 characters'),
  amount: yup
    .number()
    .typeError('Must be a number')
    .required('Amount is required')
    .positive('Must be positive')
    .integer('Must be an integer'),
  unit: yup.string().oneOf(['days', 'months', 'years']).required('Select a unit'),
});

export default function StockForm({ onSubmit, loading }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: yupResolver(schema),
    mode: 'onTouched',
  });

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col sm:flex-row gap-4 items-center justify-center w-full max-w-xl"
      noValidate
    >
      <div className="flex flex-col w-full sm:w-auto flex-grow">
        <input
          {...register('ticker')}
          placeholder="Ticker Symbol"
          className={`p-3 rounded-md text-primary font-semibold text-lg shadow-md border ${
            errors.ticker ? 'border-red-500' : 'border-transparent'
          } focus:border-yellow-400 focus:outline-none transition`}
          autoComplete="off"
          disabled={loading}
        />
        {errors.ticker && (
          <p className="text-red-500 mt-1 text-sm">{errors.ticker.message}</p>
        )}
      </div>

      <div className="flex gap-2 w-full sm:w-auto">
        <div className="flex flex-col flex-grow">
          <input
            {...register('amount')}
            type="number"
            placeholder="Amount"
            className={`p-3 rounded-md text-primary font-semibold text-lg shadow-md border ${
              errors.amount ? 'border-red-500' : 'border-transparent'
            } focus:border-yellow-400 focus:outline-none transition`}
            min="1"
            disabled={loading}
          />
          {errors.amount && (
            <p className="text-red-500 mt-1 text-sm">{errors.amount.message}</p>
          )}
        </div>

        <div className="flex flex-col w-28">
          <select
            {...register('unit')}
            className={`p-3 rounded-md text-primary font-semibold text-lg shadow-md border ${
              errors.unit ? 'border-red-500' : 'border-transparent'
            } focus:border-yellow-400 focus:outline-none transition`}
            disabled={loading}
            defaultValue=""
          >
            <option value="" disabled>
              Select Unit
            </option>
            <option value="days">Days</option>
            <option value="months">Months</option>
            <option value="years">Years</option>
          </select>
          {errors.unit && (
            <p className="text-red-500 mt-1 text-sm">{errors.unit.message}</p>
          )}
        </div>
      </div>

      <motion.button
        type="submit"
        disabled={loading}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="bg-yellow-400 text-primary font-bold px-8 py-3 rounded-md shadow-lg disabled:opacity-50 transition"
      >
        {loading ? 'Predicting...' : 'Predict'}
      </motion.button>
    </form>
  );
}
