import React from 'react';
import { Box, Typography } from '@mui/material';

export default function Hero({ children }) {
  return (
    <Box textAlign="center" mb={6}>
      <Typography variant="h3" fontWeight="bold" color="secondary.main" gutterBottom>
        Predict Your Stock’s Future Price
      </Typography>
      <Typography variant="body1" color="text.secondary" mb={4}>
        Enter a ticker symbol, choose your prediction horizon, and watch StockVision analyze the future trends.
      </Typography>
      {children}
    </Box>
  );
}
